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
MODEL_ROUTES_FILE = ROOT / os.environ.get("MODEL_ROUTES_FILE", "model-routes.json")
PUBLIC_FILES = {
    "/index.html",
    "/admin.html",
    "/gallery.html",
    "/styles.css",
    "/app.js",
    "/admin.js",
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

DEFAULT_SIZES = [
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
]
DEFAULT_QUALITIES = ["low", "medium", "high", "auto"]
DEFAULT_FORMATS = ["png", "jpeg", "webp"]
SUPPORTED_PROTOCOLS = {"openai_images", "gemini_native", "openai_responses_image"}
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
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")


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
_ROUTES_LOCK = threading.Lock()


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
        if parsed.path == "/api/models":
            self.handle_models()
            return
        if parsed.path == "/api/admin/model-routes":
            self.handle_admin_get_routes()
            return
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
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
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
        if parsed.path == "/api/admin/test-provider":
            self.handle_admin_test_provider()
            return
        if parsed.path == "/api/admin/provider-health/reset":
            self.handle_admin_reset_provider_health()
            return
        self.send_json(404, {"error": "Not found"})

    def do_PUT(self):
        if not self._check_host():
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/admin/model-routes":
            self.handle_admin_put_routes()
            return
        self.send_json(404, {"error": "Not found"})

    def handle_image_request(self, upstream_path):
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
        routes = get_model_routes()
        model_map = build_model_map(routes)

        if not site_key:
            self.send_json(401, {"error": "请输入 key。"})
            return
        if not prompt:
            self.send_json(400, {"error": "请输入提示词。"})
            return
        if not models or any(model not in model_map for model in models):
            self.send_json(400, {"error": "不支持的模型。"})
            return
        if not n or n < 1 or n > MAX_IMAGES_PER_MODEL:
            self.send_json(400, {"error": f"每个模型一次最多生成 {MAX_IMAGES_PER_MODEL} 张。"})
            return
        total_requested = len(models) * n
        if total_requested > MAX_TOTAL_IMAGES:
            self.send_json(400, {"error": f"单次最多生成 {MAX_TOTAL_IMAGES} 张，请减少模型或数量。"})
            return
        if any(size not in model_map[model].get("sizes", []) for model in models):
            self.send_json(400, {"error": "不支持的尺寸。"})
            return
        if any(quality not in model_map[model].get("qualities", []) for model in models):
            self.send_json(400, {"error": "不支持的质量。"})
            return
        if any(output_format not in model_map[model].get("formats", []) for model in models):
            self.send_json(400, {"error": "不支持的输出格式。"})
            return
        if is_edit and any(not model_map[model].get("supports_edit", False) for model in models):
            self.send_json(400, {"error": "所选模型不支持图生图 / 图片编辑。"})
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
            results, errors = upstream_client.batch_generate(routes, tasks)
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

    def handle_models(self):
        self.send_json(200, {"models": public_models(get_model_routes())})

    def handle_admin_get_routes(self):
        if not self.require_admin():
            return
        self.send_json(200, redact_routes(get_model_routes()))

    def handle_admin_put_routes(self):
        if not self.require_admin():
            return
        body = self.read_json_body()
        if body is None:
            return
        try:
            routes = validate_model_routes(body, allow_masked_keys=True)
            current = get_model_routes()
            routes = merge_masked_api_keys(current, routes)
            save_model_routes(routes)
            upstream_client.clear_provider_health()
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        self.send_json(200, redact_routes(routes))

    def handle_admin_test_provider(self):
        if not self.require_admin():
            return
        body = self.read_json_body()
        if body is None:
            return
        provider = body.get("provider")
        prompt = str(body.get("prompt") or "A simple red square icon on a white background.").strip()
        if not isinstance(provider, dict):
            self.send_json(400, {"error": "provider 配置缺失。"})
            return
        try:
            provider = validate_provider(provider, allow_masked_key=False)
            from time import monotonic
            started = monotonic()
            result = upstream_client.test_provider(provider, str(body.get("model_id") or "test-model"), {
                "prompt": prompt,
                "size": str(body.get("size") or "1024x1024"),
                "quality": str(body.get("quality") or "low"),
                "output_format": str(body.get("output_format") or "png"),
                "image": body.get("image") if isinstance(body.get("image"), dict) else None,
                "is_edit": bool(body.get("is_edit")),
                "index": 1,
                "order": 1,
            })
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        if result.get("error"):
            self.send_json(200, {"ok": False, "elapsed": round(monotonic() - started, 1), "error": result["error"]})
            return
        self.send_json(200, {
            "ok": True,
            "elapsed": round(monotonic() - started, 1),
            "has_b64_json": bool(result.get("b64_json")),
            "has_url": bool(result.get("url")),
            "provider_id": provider["id"],
        })

    def handle_admin_reset_provider_health(self):
        if not self.require_admin():
            return
        upstream_client.clear_provider_health()
        self.send_json(200, {"ok": True})

    def require_admin(self):
        if not ADMIN_TOKEN:
            self.send_json(503, {"error": "ADMIN_TOKEN 未配置。"})
            return False
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self.send_json(401, {"error": "缺少管理 Token。"})
            return False
        if auth.removeprefix("Bearer ").strip() != ADMIN_TOKEN:
            self.send_json(403, {"error": "管理 Token 不正确。"})
            return False
        return True

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


def get_model_routes():
    with _ROUTES_LOCK:
        return load_model_routes()


def load_model_routes():
    if MODEL_ROUTES_FILE.exists():
        payload = json.loads(MODEL_ROUTES_FILE.read_text(encoding="utf-8"))
        return validate_model_routes(payload)
    return validate_model_routes(default_model_routes())


def save_model_routes(routes):
    payload = json.dumps(validate_model_routes(routes), ensure_ascii=False, indent=2) + "\n"
    tmp = MODEL_ROUTES_FILE.with_suffix(MODEL_ROUTES_FILE.suffix + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, MODEL_ROUTES_FILE)


def default_model_routes():
    providers = []
    if UPSTREAM_BASE_URL and UPSTREAM_API_KEY:
        providers.append({
            "id": "default-openai",
            "enabled": True,
            "priority": 10,
            "protocol": UPSTREAM_PROTOCOL if UPSTREAM_PROTOCOL in SUPPORTED_PROTOCOLS else "openai_images",
            "base_url": UPSTREAM_BASE_URL,
            "api_key": UPSTREAM_API_KEY,
            "upstream_model": "gpt-image-2",
            "supports_generate": True,
            "supports_edit": True,
            "headers_preset": None,
        })
    return {
        "models": [{
            "id": "gpt-image-2",
            "label": "gpt-image-2",
            "enabled": True,
            "supports_edit": True,
            "sizes": DEFAULT_SIZES,
            "qualities": DEFAULT_QUALITIES,
            "formats": DEFAULT_FORMATS,
            "providers": providers,
        }]
    }


def build_model_map(routes):
    return {
        model["id"]: model
        for model in routes.get("models", [])
        if model.get("enabled") is True
    }


def public_models(routes):
    models = []
    for model in routes.get("models", []):
        if model.get("enabled") is not True:
            continue
        if not enabled_providers(model):
            continue
        models.append({
            "id": model["id"],
            "label": model.get("label") or model["id"],
            "supports_edit": bool(model.get("supports_edit")),
            "sizes": model.get("sizes", DEFAULT_SIZES),
            "qualities": model.get("qualities", DEFAULT_QUALITIES),
            "formats": model.get("formats", DEFAULT_FORMATS),
        })
    return models


def enabled_providers(model):
    providers = [
        provider for provider in model.get("providers", [])
        if provider.get("enabled") is True
    ]
    return sorted(providers, key=lambda item: int(item.get("priority", 100)))


def validate_model_routes(payload, allow_masked_keys=False):
    if not isinstance(payload, dict):
        raise ValueError("模型路由配置必须是 JSON 对象。")
    raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        raise ValueError("models 必须是数组。")
    seen_models = set()
    models = []
    for raw_model in raw_models:
        if not isinstance(raw_model, dict):
            raise ValueError("models 内每一项必须是对象。")
        model_id = clean_required_string(raw_model, "id", "模型 id")
        if model_id in seen_models:
            raise ValueError(f"模型 id 重复：{model_id}")
        seen_models.add(model_id)
        providers = raw_model.get("providers")
        if not isinstance(providers, list) or not providers:
            raise ValueError(f"模型 {model_id} 至少需要一个 provider。")
        seen_providers = set()
        clean_providers = []
        for provider in providers:
            clean_provider = validate_provider(provider, allow_masked_key=allow_masked_keys)
            if clean_provider["id"] in seen_providers:
                raise ValueError(f"模型 {model_id} 的 provider id 重复：{clean_provider['id']}")
            seen_providers.add(clean_provider["id"])
            clean_providers.append(clean_provider)
        models.append({
            "id": model_id,
            "label": str(raw_model.get("label") or model_id).strip(),
            "enabled": raw_model.get("enabled") is not False,
            "supports_edit": bool(raw_model.get("supports_edit", True)),
            "sizes": clean_string_list(raw_model.get("sizes"), DEFAULT_SIZES, f"模型 {model_id} sizes"),
            "qualities": clean_string_list(raw_model.get("qualities"), DEFAULT_QUALITIES, f"模型 {model_id} qualities"),
            "formats": clean_string_list(raw_model.get("formats"), DEFAULT_FORMATS, f"模型 {model_id} formats"),
            "providers": clean_providers,
        })
    return {"models": models}


def validate_provider(provider, allow_masked_key=False):
    if not isinstance(provider, dict):
        raise ValueError("provider 必须是对象。")
    provider_id = clean_required_string(provider, "id", "provider id")
    protocol = clean_required_string(provider, "protocol", f"provider {provider_id} protocol")
    if protocol not in SUPPORTED_PROTOCOLS:
        raise ValueError(f"provider {provider_id} 协议不支持：{protocol}")
    base_url = clean_required_string(provider, "base_url", f"provider {provider_id} base_url")
    api_key = clean_required_string(provider, "api_key", f"provider {provider_id} api_key")
    if not allow_masked_key and is_masked_secret(api_key):
        raise ValueError(f"provider {provider_id} api_key 不能是脱敏值。")
    upstream_model = clean_required_string(provider, "upstream_model", f"provider {provider_id} upstream_model")
    headers_preset = provider.get("headers_preset")
    if headers_preset not in (None, "", "browser"):
        raise ValueError(f"provider {provider_id} headers_preset 不支持：{headers_preset}")
    try:
        priority = int(provider.get("priority", 100))
    except (TypeError, ValueError):
        raise ValueError(f"provider {provider_id} priority 必须是整数。")
    return {
        "id": provider_id,
        "enabled": provider.get("enabled") is not False,
        "priority": priority,
        "protocol": protocol,
        "base_url": base_url,
        "api_key": api_key,
        "upstream_model": upstream_model,
        "supports_generate": provider.get("supports_generate") is not False,
        "supports_edit": provider.get("supports_edit") is not False,
        "headers_preset": headers_preset or None,
    }


def clean_required_string(mapping, key, label):
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} 不能为空。")
    return value.strip()


def clean_string_list(value, default, label):
    if value is None:
        return list(default)
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} 必须是非空字符串数组。")
    cleaned = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{label} 必须是非空字符串数组。")
        text = item.strip()
        if text not in cleaned:
            cleaned.append(text)
    return cleaned


def redact_routes(routes):
    redacted = json.loads(json.dumps(routes, ensure_ascii=False))
    for model in redacted.get("models", []):
        for provider in model.get("providers", []):
            provider["api_key"] = mask_secret(provider.get("api_key", ""))
    return redacted


def merge_masked_api_keys(current, incoming):
    current_keys = {}
    for model in current.get("models", []):
        for provider in model.get("providers", []):
            current_keys[(model.get("id"), provider.get("id"))] = provider.get("api_key", "")
    for model in incoming.get("models", []):
        for provider in model.get("providers", []):
            if is_masked_secret(provider.get("api_key", "")):
                provider["api_key"] = current_keys.get((model.get("id"), provider.get("id")), provider["api_key"])
    return incoming


def mask_secret(value):
    if not value:
        return ""
    return f"***{value[-6:]}" if len(value) > 6 else "***"


def is_masked_secret(value):
    return isinstance(value, str) and value.startswith("***")


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
