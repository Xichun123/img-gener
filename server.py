#!/usr/bin/env python3
import http.server
import json
import mimetypes
import os
import pathlib
import threading
import urllib.parse

import upstream_client


ROOT = pathlib.Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "5173"))
KEYS_FILE = ROOT / os.environ.get("SITE_KEYS_FILE", "keys.json")
PUBLIC_FILES = {
    "/index.html",
    "/gallery.html",
    "/styles.css",
    "/app.js",
    "/prompt-gallery.js",
    "/prompt-templates.json",
    "/prompt-cases.json",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/favicon.png",
    "/apple-touch-icon.png",
    "/assets/icon-512.png",
    "/assets/icon-source.png",
}
MAX_BODY_BYTES = 28 * 1024 * 1024

mimetypes.add_type("application/manifest+json", ".webmanifest")

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
UPSTREAM_PROTOCOL = os.environ.get("UPSTREAM_PROTOCOL", "openai")


def _split_env_set(name):
    raw = os.environ.get(name, "")
    return {item.strip() for item in raw.split(",") if item.strip()}


ALLOWED_HOSTS = _split_env_set("ALLOWED_HOSTS") | {
    f"127.0.0.1:{PORT}",
    f"localhost:{PORT}",
    f"[::1]:{PORT}",
}
ALLOWED_ORIGINS = _split_env_set("ALLOWED_ORIGINS")
_KEYS_LOCK = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ImageKeyProxy/1.0"

    def _check_host(self):
        host = self.headers.get("Host", "")
        if host in ALLOWED_HOSTS:
            return True
        self.send_text(403, "Forbidden host")
        return False

    def do_GET(self):
        if not self._check_host():
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_json(405, {"error": "Method not allowed"})
            return
        self.serve_static(parsed.path)

    def do_HEAD(self):
        if not self._check_host():
            return
        parsed = urllib.parse.urlparse(self.path)
        self.serve_static(parsed.path, head_only=True)

    def do_OPTIONS(self):
        if not self._check_host():
            return
        self.send_response(204)
        if self.send_cors_headers():
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        if not self._check_host():
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/generate":
            self.handle_image_request("/v1/images/generations")
            return
        if parsed.path == "/api/edit":
            self.handle_image_request("/v1/images/edits")
            return
        if parsed.path == "/api/key-status":
            self.handle_key_status()
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
        is_edit = upstream_path.endswith("/edits")

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
        if is_edit and not image:
            self.send_json(400, {"error": "请上传图片。"})
            return

        reserved, key_error = reserve_key_usage(site_key, total_requested)
        if key_error:
            self.send_json(key_error[0], {"error": key_error[1]})
            return

        tasks = []
        order = 0
        for model in models:
            for request_index in range(1, n + 1):
                order += 1
                tasks.append({
                    "order": order, "model": model, "index": request_index,
                    "prompt": prompt, "size": size, "quality": quality,
                    "output_format": output_format, "image": image, "is_edit": is_edit,
                })

        try:
            results, errors = upstream_client.batch_generate(MODEL_CLIENT_MAP, tasks)
        except Exception:
            adjust_key_usage(site_key, -total_requested)
            raise

        for item in results:
            item.pop("order", None)

        refund = total_requested - len(results)
        if refund > 0:
            updated = adjust_key_usage(site_key, -refund)
            if updated:
                reserved = updated

        if not results:
            message = errors[0]["error"] if errors else "接口没有返回图片数据。"
            self.send_json(502, {"error": message, "errors": errors})
            return

        self.send_json(200, {
            "data": results,
            "errors": errors,
            "size": size,
            "quality": quality,
            "output_format": output_format,
            "siteKey": {
                "remaining": max(reserved["limit"] - reserved["used"], 0),
                "used": reserved["used"],
                "limit": reserved["limit"],
            },
        })

    def handle_key_status(self):
        body = self.read_json_body()
        if body is None:
            return
        site_key = str(body.get("siteKey", "")).strip()
        if not site_key:
            self.send_json(400, {"error": "请输入 key。"})
            return
        record, key_error = get_key_status(site_key)
        if key_error:
            self.send_json(key_error[0], {"error": key_error[1]})
            return
        self.send_json(200, {
            "remaining": max(record["limit"] - record["used"], 0),
            "used": record["used"],
            "limit": record["limit"],
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
        stat = file_path.stat()
        etag = f'W/"{int(stat.st_mtime)}-{stat.st_size}"'
        cache_control = (
            "public, max-age=86400, immutable" if is_thumb
            else "public, max-age=300, must-revalidate"
        )
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache_control)
            self.end_headers()
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Cache-Control", cache_control)
        self.send_header("ETag", etag)
        self.send_header("Content-Length", str(stat.st_size))
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
        origin = self.headers.get("Origin")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            return True
        return False

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


def _init_model_client_map():
    """Build model -> UpstreamClient mapping at startup."""
    protocol_clients = {}
    model_map = {}
    for model in ALLOWED_MODELS:
        protocol = "gemini" if model in GEMINI_IMAGE_MODELS else "openai"
        if protocol not in protocol_clients:
            protocol_clients[protocol] = upstream_client.create_client(
                base_url=UPSTREAM_BASE_URL,
                api_key=UPSTREAM_API_KEY,
                protocol=protocol,
                timeout=UPSTREAM_TIMEOUT,
            )
        model_map[model] = protocol_clients[protocol]
    return model_map


MODEL_CLIENT_MAP = _init_model_client_map()


def load_keys():
    if not KEYS_FILE.exists():
        return {}
    return json.loads(KEYS_FILE.read_text(encoding="utf-8"))


def save_keys(keys):
    payload = json.dumps(keys, ensure_ascii=False, indent=2) + "\n"
    tmp = KEYS_FILE.with_suffix(KEYS_FILE.suffix + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, KEYS_FILE)


def reserve_key_usage(site_key, requested):
    with _KEYS_LOCK:
        keys = load_keys()
        record = keys.get(site_key)
        err = validate_key(record)
        if err:
            return None, err
        remaining = record["limit"] - record["used"]
        if remaining <= 0:
            return None, (429, "这个 key 的次数已用完。")
        if remaining < requested:
            return None, (429, f"这个 key 剩余 {remaining} 次，不够本次请求的 {requested} 张。")
        record["used"] += requested
        record["updatedAt"] = iso_now()
        save_keys(keys)
        return dict(record), None


def adjust_key_usage(site_key, delta):
    if delta == 0:
        return None
    with _KEYS_LOCK:
        keys = load_keys()
        record = keys.get(site_key)
        if not record:
            return None
        record["used"] = max(0, int(record.get("used", 0)) + delta)
        record["updatedAt"] = iso_now()
        save_keys(keys)
        return dict(record)


def get_key_status(site_key):
    with _KEYS_LOCK:
        record = load_keys().get(site_key)
        err = validate_key(record)
        if err:
            return None, err
        return dict(record), None


def validate_key(key_record):
    if not key_record:
        return 401, "key 无效。"
    if key_record.get("enabled") is False:
        return 403, "这个 key 已被禁用。"
    if not isinstance(key_record.get("limit"), int) or not isinstance(key_record.get("used"), int):
        return 500, "key 配置格式错误。"
    return None


def iso_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    upstream_client.init_executor(max_workers=MAX_CONCURRENT_UPSTREAM)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as server:
        print(f"Image console running at http://127.0.0.1:{PORT}")
        server.serve_forever()
