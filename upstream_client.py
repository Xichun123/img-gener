#!/usr/bin/env python3
"""
Upstream image generation client with protocol adapters.
Supports OpenAI and Gemini native protocols.
"""
import base64
import concurrent.futures
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple


class UpstreamHTTPError(Exception):
    """HTTP error from upstream API."""
    def __init__(self, message: str, status_code: int):
        self.status_code = status_code
        super().__init__(message)


# Global thread pool for upstream concurrency control
_UPSTREAM_EXECUTOR = None
_MAX_WORKERS = 4


def init_executor(max_workers: int = 4):
    """Initialize global thread pool."""
    global _UPSTREAM_EXECUTOR, _MAX_WORKERS
    _MAX_WORKERS = max_workers
    _UPSTREAM_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)


def get_executor():
    """Get or create global thread pool."""
    global _UPSTREAM_EXECUTOR
    if _UPSTREAM_EXECUTOR is None:
        init_executor(_MAX_WORKERS)
    return _UPSTREAM_EXECUTOR


def shutdown_executor(wait: bool = True):
    """Shutdown global thread pool."""
    global _UPSTREAM_EXECUTOR
    if _UPSTREAM_EXECUTOR is not None:
        _UPSTREAM_EXECUTOR.shutdown(wait=wait)
        _UPSTREAM_EXECUTOR = None


class UpstreamClient:
    """Base upstream client."""

    def __init__(self, base_url: str, api_key: str, timeout: int = 600):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def generate(
        self,
        model: str,
        prompt: str,
        size: str = "auto",
        quality: str = "auto",
        output_format: str = "png",
        image: Optional[Dict] = None,
        is_edit: bool = False,
    ) -> Dict:
        raise NotImplementedError

    def _make_request(
        self,
        url: str,
        data: bytes,
        content_type: str = "application/json",
    ) -> Dict:
        request = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": content_type,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            error_text = error.read().decode("utf-8", errors="replace")
            try:
                error_payload = json.loads(error_text)
                message = _extract_error(error_payload) or f"HTTP {error.code}"
            except json.JSONDecodeError:
                message = error_text[:500] or f"HTTP {error.code}"
            raise UpstreamHTTPError(message, error.code) from error


class OpenAIClient(UpstreamClient):
    """OpenAI protocol client."""

    def generate(
        self,
        model: str,
        prompt: str,
        size: str = "auto",
        quality: str = "auto",
        output_format: str = "png",
        image: Optional[Dict] = None,
        is_edit: bool = False,
    ) -> Dict:
        endpoint = "/v1/images/edits" if is_edit else "/v1/images/generations"
        url = f"{self.base_url}{endpoint}"

        payload = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "quality": quality,
            "output_format": output_format,
        }

        if is_edit and image:
            data, content_type = self._build_multipart(payload, image)
        else:
            data = json.dumps(payload).encode("utf-8")
            content_type = "application/json"

        response = self._make_request(url, data, content_type)

        data_items = response.get("data", [])
        if not isinstance(data_items, list) or not data_items:
            raise ValueError("接口没有返回图片数据。")

        return {
            "b64_json": data_items[0].get("b64_json"),
            "revised_prompt": data_items[0].get("revised_prompt"),
        }

    def _build_multipart(self, fields: Dict, image: Dict) -> Tuple[bytes, str]:
        boundary = f"----ImgGener{secrets.token_hex(12)}"
        parts = []

        for key, value in fields.items():
            parts.append(
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                f"{value}\r\n".encode("utf-8")
            )

        image_bytes = base64.b64decode(str(image.get("data", "")), validate=True)
        if len(image_bytes) > 20 * 1024 * 1024:
            raise ValueError("图片太大，最大 20MB。")

        filename = self._sanitize_filename(str(image.get("name") or "image.png"))
        mime = str(image.get("type") or "application/octet-stream")
        if mime not in {"image/png", "image/jpeg", "image/webp"}:
            raise ValueError("只支持 PNG / JPEG / WebP。")

        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
            f"Content-Type: {mime}\r\n\r\n".encode("utf-8")
            + image_bytes
            + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode("utf-8"))

        return b"".join(parts), f"multipart/form-data; boundary={boundary}"

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        return "".join(ch for ch in name if ch.isalnum() or ch in {".", "_", "-"})[:120] or "image.png"


class GeminiClient(UpstreamClient):
    """Gemini native protocol client."""

    def generate(
        self,
        model: str,
        prompt: str,
        size: str = "auto",
        quality: str = "auto",
        output_format: str = "png",
        image: Optional[Dict] = None,
        is_edit: bool = False,
    ) -> Dict:
        url = f"{self.base_url}/v1beta/models/{urllib.parse.quote(model, safe='')}:generateContent"

        parts = []
        if is_edit and image:
            image_data = str(image.get("data", ""))
            if not image_data:
                raise ValueError("图片数据为空。")
            mime = str(image.get("type") or "application/octet-stream")
            if mime not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("只支持 PNG / JPEG / WebP。")
            parts.append({"inlineData": {"mimeType": mime, "data": image_data}})

        parts.append({"text": prompt})

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
        }

        data = json.dumps(payload).encode("utf-8")
        response = self._make_request(url, data)

        inline_data = self._find_inline_data(response)
        if not inline_data:
            raise ValueError("接口没有返回图片数据。")

        return {
            "b64_json": inline_data["data"],
            "revised_prompt": None,
        }

    @staticmethod
    def _find_inline_data(value) -> Optional[Dict]:
        stack = [value]
        while stack:
            current = stack.pop()
            if isinstance(current, dict):
                inline_data = current.get("inlineData") or current.get("inline_data")
                if isinstance(inline_data, dict) and inline_data.get("data"):
                    return inline_data
                stack.extend(current.values())
            elif isinstance(current, list):
                stack.extend(current)
        return None


def create_client(
    base_url: str,
    api_key: str,
    protocol: str = "openai",
    timeout: int = 600,
) -> UpstreamClient:
    if protocol == "gemini":
        return GeminiClient(base_url, api_key, timeout)
    elif protocol == "openai":
        return OpenAIClient(base_url, api_key, timeout)
    else:
        raise ValueError(f"不支持的协议：{protocol}")


def batch_generate(
    model_client_map: Dict[str, UpstreamClient],
    tasks: List[Dict],
) -> Tuple[List[Dict], List[Dict]]:
    """
    Batch generate images using global thread pool.

    Args:
        model_client_map: Dict mapping model name to UpstreamClient instance
        tasks: List of task dicts with keys: order, model, index, prompt, size, quality, output_format, image, is_edit

    Returns:
        Tuple of (results, errors)
    """
    executor = get_executor()
    futures = [
        executor.submit(_generate_single, model_client_map, task)
        for task in tasks
    ]

    results = []
    errors = []

    for future in concurrent.futures.as_completed(futures):
        result = future.result()
        if result.get("error"):
            errors.append(result)
        else:
            results.append(result)

    results.sort(key=lambda item: item.get("order", 0))
    return results, errors


def _generate_single(model_client_map: Dict[str, UpstreamClient], task: Dict) -> Dict:
    model = task["model"]
    request_index = task["index"]
    order = task["order"]

    client = model_client_map.get(model)
    if not client:
        return {
            "model": model, "index": request_index, "order": order,
            "error": f"模型 {model} 没有对应的上游客户端。",
        }

    try:
        result = client.generate(
            model=model,
            prompt=task["prompt"],
            size=task.get("size", "auto"),
            quality=task.get("quality", "auto"),
            output_format=task.get("output_format", "png"),
            image=task.get("image"),
            is_edit=task.get("is_edit", False),
        )
        return {
            "model": model,
            "result_index": request_index,
            "order": order,
            "b64_json": result["b64_json"],
            "revised_prompt": result.get("revised_prompt"),
        }
    except UpstreamHTTPError as error:
        return {
            "model": model, "index": request_index, "order": order,
            "error": f"上游请求失败：{error}",
        }
    except ValueError as error:
        return {
            "model": model, "index": request_index, "order": order,
            "error": str(error),
        }
    except Exception as error:
        return {
            "model": model, "index": request_index, "order": order,
            "error": f"上游请求失败：{error}",
        }


def _extract_error(payload: Dict) -> Optional[str]:
    error = payload.get("error")
    if isinstance(error, dict):
        return error.get("message")
    if isinstance(error, str):
        return error
    return payload.get("message")
