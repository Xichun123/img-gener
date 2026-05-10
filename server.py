#!/usr/bin/env python3
import concurrent.futures
import http.server
import base64
import json
import mimetypes
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "5173"))
KEYS_FILE = ROOT / os.environ.get("SITE_KEYS_FILE", "keys.json")
PUBLIC_FILES = {
    "/index.html",
    "/gallery.html",
    "/styles.css",
    "/app.js",
    "/prompt-gallery.js",
    "/prompt-templates.js",
    "/prompt-cases.js",
    "/favicon.ico",
    "/favicon.png",
    "/apple-touch-icon.png",
    "/assets/icon-512.png",
    "/assets/icon-source.png",
}
MAX_BODY_BYTES = 28 * 1024 * 1024

ALLOWED_MODELS = {
    "gpt-image-2",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
}
GEMINI_IMAGE_MODELS = {
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
}
ALLOWED_SIZES = {
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "1792x1024",
    "1024x1792",
    "2048x2048",
    "2048x3072",
    "3072x2048",
    "3840x2160",
    "2160x3840",
}
ALLOWED_QUALITIES = {"low", "medium", "high", "auto"}
ALLOWED_FORMATS = {"png", "jpeg", "webp"}
MAX_IMAGES_PER_MODEL = 4
MAX_TOTAL_IMAGES = 6
MAX_CONCURRENT_UPSTREAM = 4


def load_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_env()
UPSTREAM_BASE_URL = os.environ.get("UPSTREAM_BASE_URL")
UPSTREAM_API_KEY = os.environ.get("UPSTREAM_API_KEY")
UPSTREAM_TIMEOUT = int(os.environ.get("UPSTREAM_TIMEOUT", "600"))


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ImageKeyProxy/1.0"

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/key-status":
            self.handle_key_status(parsed)
            return
        self.serve_static(parsed.path)

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        self.serve_static(parsed.path, head_only=True)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/generate":
            self.handle_image_request("/v1/images/generations")
            return
        if parsed.path == "/api/edit":
            self.handle_image_request("/v1/images/edits")
            return
        self.send_json(404, {"error": "Not found"})

    def handle_image_request(self, upstream_path):
        if not UPSTREAM_BASE_URL or not UPSTREAM_API_KEY:
            self.send_json(500, {"error": "上游配置缺失。"})
            return

        body = self.read_json_body()
        if body is None:
            return

        site_key = str(body.get("siteKey", "")).strip()
        prompt = str(body.get("prompt", "")).strip()
        models = parse_models(body)
        n = parse_count(body.get("n", 1))
        size = str(body.get("size", "")).strip()
        quality = str(body.get("quality", "")).strip()
        output_format = str(body.get("output_format", "")).strip()
        image = body.get("image") if isinstance(body.get("image"), dict) else None

        if not site_key:
            self.send_json(401, {"error": "请输入 key。"})
            return
        if not prompt:
            self.send_json(400, {"error": "请输入提示词。"})
            return
        if not models or any(model not in ALLOWED_MODELS for model in models):
            self.send_json(400, {"error": "不支持的模型。"})
            return
        if not n or n < 1 or n > MAX_IMAGES_PER_MODEL:
            self.send_json(400, {"error": f"每个模型一次最多生成 {MAX_IMAGES_PER_MODEL} 张。"})
            return
        total_requested = len(models) * n
        if total_requested > MAX_TOTAL_IMAGES:
            self.send_json(400, {"error": f"单次最多生成 {MAX_TOTAL_IMAGES} 张，请减少模型或数量。"})
            return
        if size not in ALLOWED_SIZES:
            self.send_json(400, {"error": "不支持的尺寸。"})
            return
        if quality not in ALLOWED_QUALITIES:
            self.send_json(400, {"error": "不支持的质量。"})
            return
        if output_format not in ALLOWED_FORMATS:
            self.send_json(400, {"error": "不支持的输出格式。"})
            return
        if upstream_path.endswith("/edits") and not image:
            self.send_json(400, {"error": "请上传图片。"})
            return

        keys = load_keys()
        key_record = keys.get(site_key)
        key_error = validate_key(key_record)
        if key_error:
            self.send_json(key_error[0], {"error": key_error[1]})
            return

        remaining_before = key_record["limit"] - key_record["used"]
        if remaining_before <= 0:
            self.send_json(429, {"error": "这个 key 的次数已用完。", "remaining": 0})
            return
        if remaining_before < total_requested:
            self.send_json(429, {"error": f"这个 key 剩余 {remaining_before} 次，不够本次请求的 {total_requested} 张。", "remaining": remaining_before})
            return

        results = []
        errors = []
        upstream_base_url = UPSTREAM_BASE_URL.rstrip("/")
        is_edit = upstream_path.endswith("/edits")
        tasks = []
        order = 0
        for model in models:
            for request_index in range(1, n + 1):
                order += 1
                tasks.append({"order": order, "model": model, "index": request_index})

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(MAX_CONCURRENT_UPSTREAM, len(tasks))) as executor:
            futures = [
                executor.submit(
                    self.call_single_image,
                    upstream_base_url,
                    upstream_path,
                    task["model"],
                    task["index"],
                    task["order"],
                    prompt,
                    size,
                    quality,
                    output_format,
                    image,
                    is_edit,
                )
                for task in tasks
            ]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                if result.get("error"):
                    errors.append(result)
                    continue
                results.append(result)

        results.sort(key=lambda item: item.get("order", 0))
        for item in results:
            item.pop("order", None)

        if not results:
            message = errors[0]["error"] if errors else "接口没有返回图片数据。"
            self.send_json(502, {"error": message, "errors": errors})
            return

        key_record["used"] += len(results)
        key_record["updatedAt"] = iso_now()
        save_keys(keys)

        self.send_json(200, {
            "data": results,
            "errors": errors,
            "size": size,
            "quality": quality,
            "output_format": output_format,
            "siteKey": {
                "remaining": max(key_record["limit"] - key_record["used"], 0),
                "used": key_record["used"],
                "limit": key_record["limit"],
            },
        })


    def call_single_image(self, upstream_base_url, upstream_path, model, request_index, order, prompt, size, quality, output_format, image, is_edit):
        upstream_payload = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "quality": quality,
            "output_format": output_format,
        }
        try:
            if model in GEMINI_IMAGE_MODELS:
                payload = self.call_gemini_upstream(upstream_base_url, model, prompt, image, is_edit)
            else:
                upstream_url = f"{upstream_base_url}{upstream_path}"
                payload = self.call_upstream(upstream_url, upstream_payload, image, is_edit)
        except urllib.error.HTTPError as error:
            error_payload = parse_json(error.read().decode("utf-8", errors="replace"))
            return {"model": model, "index": request_index, "order": order, "error": extract_error(error_payload) or f"上游请求失败：HTTP {error.code}"}
        except Exception as error:
            return {"model": model, "index": request_index, "order": order, "error": f"上游请求失败：{error}"}

        if model in GEMINI_IMAGE_MODELS:
            inline_data = find_gemini_inline_data(payload)
            if not inline_data:
                return {"model": model, "index": request_index, "order": order, "error": "接口没有返回图片数据。"}
            copied = {"b64_json": inline_data["data"]}
        else:
            data_items = payload.get("data", [])
            if not isinstance(data_items, list) or not data_items or not isinstance(data_items[0], dict):
                return {"model": model, "index": request_index, "order": order, "error": "接口没有返回图片数据。"}
            copied = dict(data_items[0])
        copied["model"] = model
        copied["result_index"] = request_index
        copied["order"] = order
        return copied

    def call_upstream(self, upstream_url, upstream_payload, image, is_edit):
        if is_edit:
            data, content_type = build_multipart(upstream_payload, image)
        else:
            data = json.dumps(upstream_payload).encode("utf-8")
            content_type = "application/json"

        request = urllib.request.Request(
            upstream_url,
            data=data,
            headers={"Authorization": f"Bearer {UPSTREAM_API_KEY}", "Content-Type": content_type},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))

    def call_gemini_upstream(self, upstream_base_url, model, prompt, image, is_edit):
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

        upstream_payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
        }
        request = urllib.request.Request(
            f"{upstream_base_url}/v1beta/models/{urllib.parse.quote(model, safe='')}:generateContent",
            data=json.dumps(upstream_payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {UPSTREAM_API_KEY}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))

    def handle_key_status(self, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        site_key = str(query.get("siteKey", [""])[0]).strip()
        if not site_key:
            self.send_json(400, {"error": "请输入 key。"})
            return
        key_record = load_keys().get(site_key)
        key_error = validate_key(key_record)
        if key_error:
            self.send_json(key_error[0], {"error": key_error[1]})
            return
        self.send_json(200, {
            "remaining": max(key_record["limit"] - key_record["used"], 0),
            "used": key_record["used"],
            "limit": key_record["limit"],
        })

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "请求体太大。"})
            return None
        text = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            self.send_json(400, {"error": "JSON 格式错误。"})
            return None

    def serve_static(self, raw_path, head_only=False):
        safe_path = "/index.html" if raw_path == "/" else urllib.parse.unquote(raw_path)
        is_thumb = safe_path.startswith("/case-thumbs/") and safe_path.endswith(".webp")
        if safe_path not in PUBLIC_FILES and not is_thumb:
            self.send_text(404, "Not found")
            return
        file_path = (ROOT / safe_path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.exists():
            self.send_text(404, "Not found")
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Cache-Control", "public, max-age=86400" if is_thumb else "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(file_path.read_bytes())

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_text(self, status, text):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")



def parse_models(body):
    raw_models = body.get("models")
    if isinstance(raw_models, list):
        candidates = raw_models
    else:
        candidates = [body.get("model", "")]
    models = []
    for candidate in candidates:
        model = str(candidate).strip()
        if model and model not in models:
            models.append(model)
    return models


def parse_count(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0

def load_keys():
    if not KEYS_FILE.exists():
        return {}
    return json.loads(KEYS_FILE.read_text(encoding="utf-8"))


def save_keys(keys):
    KEYS_FILE.write_text(json.dumps(keys, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_key(key_record):
    if not key_record:
        return 401, "key 无效。"
    if key_record.get("enabled") is False:
        return 403, "这个 key 已被禁用。"
    if not isinstance(key_record.get("limit"), int) or not isinstance(key_record.get("used"), int):
        return 500, "key 配置格式错误。"
    return None


def parse_json(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {}


def extract_error(payload):
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return error.get("message")
    if isinstance(error, str):
        return error
    return payload.get("message") if isinstance(payload, dict) else None


def find_gemini_inline_data(value):
    if isinstance(value, dict):
        inline_data = value.get("inlineData")
        if isinstance(inline_data, dict) and inline_data.get("data"):
            return inline_data
        inline_data = value.get("inline_data")
        if isinstance(inline_data, dict) and inline_data.get("data"):
            return inline_data
        for child in value.values():
            found = find_gemini_inline_data(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = find_gemini_inline_data(child)
            if found:
                return found
    return None


def build_multipart(fields, image):
    boundary = f"----ImgGener{secrets_hex()}"
    parts = []
    for key, value in fields.items():
      parts.append(
          f"--{boundary}\r\n"
          f"Content-Disposition: form-data; name=\"{key}\"\r\n\r\n"
          f"{value}\r\n".encode("utf-8")
      )
    image_bytes = base64.b64decode(str(image.get("data", "")), validate=True)
    if len(image_bytes) > 20 * 1024 * 1024:
        raise ValueError("图片太大，最大 20MB。")
    filename = sanitize_filename(str(image.get("name") or "image.png"))
    mime = str(image.get("type") or "application/octet-stream")
    if mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise ValueError("只支持 PNG / JPEG / WebP。")
    parts.append(
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n".encode("utf-8")
        + image_bytes
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def sanitize_filename(name):
    return "".join(ch for ch in name if ch.isalnum() or ch in {".", "_", "-"})[:120] or "image.png"


def secrets_hex():
    import secrets
    return secrets.token_hex(12)


def iso_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as server:
        print(f"Image console running at http://127.0.0.1:{PORT}")
        server.serve_forever()
