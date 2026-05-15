#!/usr/bin/env python3
"""
Upstream image generation client with protocol adapters.
Supports OpenAI and Gemini native protocols.
"""
import base64
import concurrent.futures
import json
import random
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0 Safari/537.36"
    ),
    "Accept": "application/json",
}
PROBE_IMAGE_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB"
    "/6X4nQAAAABJRU5ErkJggg=="
)


class UpstreamHTTPError(Exception):
    """HTTP error from upstream API."""
    def __init__(self, message: str, status_code: int):
        self.status_code = status_code
        super().__init__(message)


# Global thread pool for upstream concurrency control
_UPSTREAM_EXECUTOR = None
_MAX_WORKERS = 4
_PROVIDER_HEALTH_LOCK = threading.Lock()
_PROVIDER_HEALTH = {}
_PROVIDER_FAILURE_THRESHOLD = 3
_PROVIDER_CIRCUIT_SECONDS = 300
_PROBE_GUARD_DELAY_RANGE = (8, 18)
_PROBE_GUARD_MAX_THROTTLED_TESTS = 3


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

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: int = 600,
        extra_headers: Optional[Dict[str, str]] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.extra_headers = extra_headers or {}

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
                **self.extra_headers,
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


def list_provider_models(provider: Dict, timeout: int = 60) -> List[str]:
    protocol = provider.get("protocol", "openai_images")
    base_url = str(provider.get("base_url") or "").rstrip("/")
    api_key = str(provider.get("api_key") or "")
    extra_headers = _provider_headers(provider) or {}

    if protocol == "gemini_native":
        url = f"{base_url}/v1beta/models"
        headers = {**extra_headers, "x-goog-api-key": api_key, "Accept": "application/json"}
    else:
        url = f"{base_url}/v1/models"
        headers = {**extra_headers, "Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_text = error.read().decode("utf-8", errors="replace")
        try:
            error_payload = json.loads(error_text)
            message = _extract_error(error_payload) or f"HTTP {error.code}"
        except json.JSONDecodeError:
            message = error_text[:500] or f"HTTP {error.code}"
        raise UpstreamHTTPError(message, error.code) from error

    return _extract_model_ids(payload, protocol)


def _extract_model_ids(payload: Dict, protocol: str) -> List[str]:
    raw_items = payload.get("data")
    if not isinstance(raw_items, list):
        raw_items = payload.get("models")
    if not isinstance(raw_items, list):
        raw_items = []

    models = []
    for item in raw_items:
        model_id = None
        if isinstance(item, dict):
            model_id = item.get("id") or item.get("name")
        elif isinstance(item, str):
            model_id = item
        if protocol == "gemini_native" and isinstance(model_id, str):
            model_id = model_id.removeprefix("models/")
        if isinstance(model_id, str) and model_id.strip() and model_id.strip() not in models:
            models.append(model_id.strip())
    return models


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
            "url": data_items[0].get("url"),
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


class OpenAIResponsesImageClient(UpstreamClient):
    """Reserved adapter for Responses API image generation."""

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
        raise ValueError("openai_responses_image 协议已预留，但当前版本未启用。")


def create_client(
    base_url: str,
    api_key: str,
    protocol: str = "openai",
    timeout: int = 600,
    extra_headers: Optional[Dict[str, str]] = None,
) -> UpstreamClient:
    if protocol in {"gemini", "gemini_native"}:
        return GeminiClient(base_url, api_key, timeout, extra_headers)
    elif protocol in {"openai", "openai_images"}:
        return OpenAIClient(base_url, api_key, timeout, extra_headers)
    elif protocol == "openai_responses_image":
        return OpenAIResponsesImageClient(base_url, api_key, timeout, extra_headers)
    else:
        raise ValueError(f"不支持的协议：{protocol}")


def batch_generate(
    routes: Dict,
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
        executor.submit(_generate_single, routes, task)
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


def test_provider(provider: Dict, model_id: str, task: Dict) -> Dict:
    return _call_provider(provider, model_id, task)


def probe_provider_capabilities(
    provider: Dict,
    model_id: str,
    candidates: Dict[str, List[str]],
    include_edit: bool = True,
    full_matrix: bool = False,
    progress_callback=None,
    probe_delay_range: Optional[Tuple[float, float]] = None,
    guard_delay_range: Optional[Tuple[float, float]] = None,
    guard_max_throttled_tests: Optional[int] = None,
) -> Dict:
    sizes = _clean_probe_values(candidates.get("sizes"), ["1024x1024"])
    qualities = _clean_probe_values(candidates.get("qualities"), ["low"])
    formats = _clean_probe_values(candidates.get("formats"), ["png"])
    preferred_size = _pick_preferred(sizes, "1024x1024")
    preferred_quality = _pick_preferred(qualities, "low")
    preferred_format = _pick_preferred(formats, "png")

    successful_sizes = set()
    successful_qualities = set()
    successful_formats = set()
    combinations = []
    tests = []
    throttle_state = {"active": False, "count": 0, "reason": None, "stopped": False}
    guard_delay_range = guard_delay_range or _PROBE_GUARD_DELAY_RANGE
    guard_max_throttled_tests = (
        _PROBE_GUARD_MAX_THROTTLED_TESTS
        if guard_max_throttled_tests is None
        else max(0, int(guard_max_throttled_tests))
    )

    planned = _build_probe_plan(
        sizes,
        qualities,
        formats,
        preferred_size,
        preferred_quality,
        preferred_format,
        include_edit,
        full_matrix,
    )
    total_steps = len(planned)

    def run_probe(mode: str, size: str, quality: str, output_format: str) -> bool:
        if throttle_state["stopped"]:
            return False
        if throttle_state["active"]:
            if throttle_state["count"] >= guard_max_throttled_tests:
                throttle_state["stopped"] = True
                if progress_callback:
                    progress_callback({
                        "type": "guard_stop",
                        "completed": len(tests),
                        "total": total_steps,
                        "reason": throttle_state["reason"] or "上游疑似风控 / 限流。",
                    })
                return False
            delay = random.uniform(*guard_delay_range)
            if progress_callback:
                progress_callback({
                    "type": "guard_wait",
                    "completed": len(tests),
                    "total": total_steps,
                    "delay": round(delay, 1),
                    "reason": throttle_state["reason"] or "上游疑似风控 / 限流。",
                })
            time.sleep(delay)
        elif probe_delay_range and tests:
            delay = random.uniform(*probe_delay_range)
            if progress_callback:
                progress_callback({
                    "type": "probe_wait",
                    "completed": len(tests),
                    "total": total_steps,
                    "delay": round(delay, 1),
                    "reason": "后台探测按间隔执行，避免短时间频繁访问上游。",
                })
            time.sleep(delay)
        if progress_callback:
            progress_callback({
                "type": "step_start",
                "completed": len(tests),
                "total": total_steps,
                "current": {
                    "mode": mode,
                    "size": size,
                    "quality": quality,
                    "format": output_format,
                },
                "success_count": sum(1 for test in tests if test.get("ok")),
            })
        task = {
            "prompt": "A simple red square icon on a white background.",
            "size": size,
            "quality": quality,
            "output_format": output_format,
            "image": _probe_image() if mode == "edit" else None,
            "is_edit": mode == "edit",
            "index": 1,
            "order": len(tests) + 1,
        }
        started = time.monotonic()
        result = _call_provider(provider, model_id, task)
        ok = not result.get("error")
        guard_reason = _probe_guard_reason(result.get("error"))
        if guard_reason:
            throttle_state["active"] = True
            throttle_state["count"] = int(throttle_state["count"]) + 1
            throttle_state["reason"] = guard_reason
        tests.append({
            "mode": mode,
            "size": size,
            "quality": quality,
            "format": output_format,
            "ok": ok,
            "elapsed": round(time.monotonic() - started, 1),
            **({"error": result.get("error")} if result.get("error") else {}),
            **({"guard_reason": guard_reason} if guard_reason else {}),
        })
        if ok:
            successful_sizes.add(size)
            successful_qualities.add(quality)
            successful_formats.add(output_format)
            combinations.append({
                "mode": mode,
                "size": size,
                "quality": quality,
                "format": output_format,
            })
        if progress_callback:
            progress_callback({
                "type": "progress",
                "completed": len(tests),
                "total": total_steps,
                "current": {
                    "mode": mode,
                    "size": size,
                    "quality": quality,
                    "format": output_format,
                },
                "ok": ok,
                "success_count": sum(1 for test in tests if test.get("ok")),
                "elapsed": tests[-1]["elapsed"],
                **({"error": result.get("error")} if result.get("error") else {}),
                **({"guard_reason": guard_reason} if guard_reason else {}),
            })
        return ok

    if full_matrix:
        for item in planned:
            if item["mode"] == "generate":
                run_probe(item["mode"], item["size"], item["quality"], item["format"])
                if throttle_state["stopped"]:
                    break
    else:
        for size in sizes:
            run_probe("generate", size, preferred_quality, preferred_format)
            if throttle_state["stopped"]:
                break
        working_size = _pick_preferred(list(successful_sizes) or sizes, preferred_size)
        if not throttle_state["stopped"]:
            for quality in qualities:
                run_probe("generate", working_size, quality, preferred_format)
                if throttle_state["stopped"]:
                    break
        working_quality = _pick_preferred(list(successful_qualities) or qualities, preferred_quality)
        if not throttle_state["stopped"]:
            for output_format in formats:
                run_probe("generate", working_size, working_quality, output_format)
                if throttle_state["stopped"]:
                    break

    supports_generate = any(test["mode"] == "generate" and test["ok"] for test in tests)
    supports_edit = False
    if include_edit and supports_generate and not throttle_state["stopped"]:
        edit_size = _pick_preferred(list(successful_sizes) or sizes, preferred_size)
        edit_quality = _pick_preferred(list(successful_qualities) or qualities, preferred_quality)
        edit_format = _pick_preferred(list(successful_formats) or formats, preferred_format)
        supports_edit = run_probe("edit", edit_size, edit_quality, edit_format)

    return {
        "supports_generate": supports_generate,
        "supports_edit": supports_edit,
        "sizes": sorted(successful_sizes, key=sizes.index),
        "qualities": sorted(successful_qualities, key=qualities.index),
        "formats": sorted(successful_formats, key=formats.index),
        "combinations": combinations,
        "matrix_complete": bool(full_matrix),
        "stopped_early": throttle_state["stopped"],
        "stop_reason": throttle_state["reason"],
        "tests": tests,
    }


def estimate_provider_capability_probe_total(candidates: Dict[str, List[str]], include_edit: bool = True, full_matrix: bool = False) -> int:
    sizes = _clean_probe_values(candidates.get("sizes"), ["1024x1024"])
    qualities = _clean_probe_values(candidates.get("qualities"), ["low"])
    formats = _clean_probe_values(candidates.get("formats"), ["png"])
    if full_matrix:
        total = len(sizes) * len(qualities) * len(formats)
    else:
        total = len(sizes) + len(qualities) + len(formats)
    if include_edit:
        total += 1
    return total


def _probe_guard_reason(error: Optional[str]) -> Optional[str]:
    if not error:
        return None
    text = error.lower()
    if "429" in text or "too many requests" in text:
        return "上游返回 429 / Too Many Requests。"
    if "<!doctype html" in text and ("cloudflare" in text or "error code:" in text or "too many requests" in text):
        return "上游返回 HTML 风控页。"
    if "error code: 1010" in text or "access denied" in text or "forbidden" in text:
        return "上游疑似风控拒绝请求。"
    return None


def _build_probe_plan(
    sizes: List[str],
    qualities: List[str],
    formats: List[str],
    preferred_size: str,
    preferred_quality: str,
    preferred_format: str,
    include_edit: bool,
    full_matrix: bool,
) -> List[Dict]:
    plan = []
    if full_matrix:
        for size in sizes:
            for quality in qualities:
                for output_format in formats:
                    plan.append({
                        "mode": "generate",
                        "size": size,
                        "quality": quality,
                        "format": output_format,
                    })
    else:
        for size in sizes:
            plan.append({
                "mode": "generate",
                "size": size,
                "quality": preferred_quality,
                "format": preferred_format,
            })
        for quality in qualities:
            plan.append({
                "mode": "generate",
                "size": preferred_size,
                "quality": quality,
                "format": preferred_format,
            })
        for output_format in formats:
            plan.append({
                "mode": "generate",
                "size": preferred_size,
                "quality": preferred_quality,
                "format": output_format,
            })
    if include_edit:
        plan.append({
            "mode": "edit",
            "size": preferred_size,
            "quality": preferred_quality,
            "format": preferred_format,
        })
    return plan


def _generate_single(routes: Dict, task: Dict) -> Dict:
    model = task["model"]
    request_index = task["index"]
    order = task["order"]
    is_edit = task.get("is_edit", False)

    model_config = _find_model(routes, model)
    if not model_config:
        return {
            "model": model, "index": request_index, "order": order,
            "error": f"模型 {model} 没有对应的路由配置。",
        }

    providers = [
        provider for provider in model_config.get("providers", [])
        if provider.get("enabled") is not False
        and ((is_edit and provider.get("supports_edit") is not False) or (not is_edit and provider.get("supports_generate") is not False))
        and provider_supports_task(provider, task)
    ]
    providers.sort(key=lambda item: int(item.get("priority", 100)))
    if not providers:
        return {
            "model": model, "index": request_index, "order": order,
            "error": f"模型 {model} 没有可用 provider。",
        }

    errors = []
    for provider in providers:
        if _provider_circuit_open(provider.get("id") or "provider"):
            errors.append({
                "provider_id": provider.get("id"),
                "error": "provider 临时熔断中。",
            })
            continue
        result = _call_provider(provider, model, task)
        if result.get("error"):
            _record_provider_failure(provider.get("id") or "provider")
            errors.append({
                "provider_id": provider.get("id"),
                "error": result.get("error"),
            })
            continue
        _record_provider_success(provider.get("id") or "provider")
        result["fallback_errors"] = errors
        return result

    return {
        "model": model,
        "index": request_index,
        "order": order,
        "error": "所有 provider 均失败。",
        "provider_errors": errors,
    }


def _find_model(routes: Dict, model_id: str) -> Optional[Dict]:
    for model in routes.get("models", []):
        if model.get("id") == model_id and model.get("enabled") is not False:
            return model
    return None


def provider_supports_task(provider: Dict, task: Dict) -> bool:
    capabilities = provider.get("capabilities")
    if not isinstance(capabilities, dict):
        return True

    mode = "edit" if task.get("is_edit", False) else "generate"
    if mode == "edit" and capabilities.get("supports_edit") is False:
        return False
    if mode == "generate" and capabilities.get("supports_generate") is False:
        return False

    size = task.get("size", "auto")
    quality = task.get("quality", "auto")
    output_format = task.get("output_format", "png")
    if size not in capabilities.get("sizes", []):
        return False
    if quality not in capabilities.get("qualities", []):
        return False
    if output_format not in capabilities.get("formats", []):
        return False

    if capabilities.get("matrix_complete") is True:
        return any(
            item.get("mode") == mode
            and item.get("size") == size
            and item.get("quality") == quality
            and item.get("format") == output_format
            for item in capabilities.get("combinations", [])
            if isinstance(item, dict)
        )
    return True


def _call_provider(provider: Dict, stable_model_id: str, task: Dict) -> Dict:
    provider_id = provider.get("id") or "provider"
    try:
        client = create_client(
            base_url=provider.get("base_url", ""),
            api_key=provider.get("api_key", ""),
            protocol=provider.get("protocol", "openai_images"),
            timeout=int(provider.get("timeout", _MAX_WORKERS * 150)),
            extra_headers=_provider_headers(provider),
        )
        result = client.generate(
            model=provider.get("upstream_model") or stable_model_id,
            prompt=task["prompt"],
            size=task.get("size", "auto"),
            quality=task.get("quality", "auto"),
            output_format=task.get("output_format", "png"),
            image=task.get("image"),
            is_edit=task.get("is_edit", False),
        )
        if not result.get("b64_json") and not result.get("url"):
            raise ValueError("接口没有返回图片数据。")
        return {
            "model": stable_model_id,
            "provider_id": provider_id,
            "result_index": task["index"],
            "order": task["order"],
            "b64_json": result.get("b64_json"),
            "url": result.get("url"),
            "revised_prompt": result.get("revised_prompt"),
        }
    except UpstreamHTTPError as error:
        return {
            "model": stable_model_id, "index": task["index"], "order": task["order"],
            "provider_id": provider_id,
            "error": f"上游请求失败：{error}",
        }
    except ValueError as error:
        return {
            "model": stable_model_id, "index": task["index"], "order": task["order"],
            "provider_id": provider_id,
            "error": str(error),
        }
    except Exception as error:
        return {
            "model": stable_model_id, "index": task["index"], "order": task["order"],
            "provider_id": provider_id,
            "error": f"上游请求失败：{error}",
        }


def _provider_headers(provider: Dict) -> Optional[Dict[str, str]]:
    if provider.get("headers_preset") == "browser":
        return BROWSER_HEADERS
    return None


def _clean_probe_values(values: Optional[List[str]], fallback: List[str]) -> List[str]:
    cleaned = []
    if isinstance(values, list):
        for value in values:
            if isinstance(value, str) and value.strip() and value.strip() not in cleaned:
                cleaned.append(value.strip())
    return cleaned or list(fallback)


def _pick_preferred(values: List[str], preferred: str) -> str:
    if preferred in values:
        return preferred
    return values[0]


def _probe_image() -> Dict:
    return {
        "name": "probe.png",
        "type": "image/png",
        "data": PROBE_IMAGE_B64,
    }


def _provider_circuit_open(provider_id: str) -> bool:
    with _PROVIDER_HEALTH_LOCK:
        state = _PROVIDER_HEALTH.get(provider_id)
        if not state:
            return False
        until = state.get("open_until", 0)
        if until and until > time.time():
            return True
        if until:
            _PROVIDER_HEALTH.pop(provider_id, None)
        return False


def _record_provider_success(provider_id: str):
    with _PROVIDER_HEALTH_LOCK:
        _PROVIDER_HEALTH.pop(provider_id, None)


def _record_provider_failure(provider_id: str):
    with _PROVIDER_HEALTH_LOCK:
        state = _PROVIDER_HEALTH.setdefault(provider_id, {"failures": 0, "open_until": 0})
        state["failures"] = int(state.get("failures", 0)) + 1
        if state["failures"] >= _PROVIDER_FAILURE_THRESHOLD:
            state["open_until"] = time.time() + _PROVIDER_CIRCUIT_SECONDS


def clear_provider_health():
    with _PROVIDER_HEALTH_LOCK:
        _PROVIDER_HEALTH.clear()


def _extract_error(payload: Dict) -> Optional[str]:
    error = payload.get("error")
    if isinstance(error, dict):
        return error.get("message")
    if isinstance(error, str):
        return error
    return payload.get("message")
