#!/usr/bin/env python3
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request


APP_ROOT = pathlib.Path(os.environ.get("IMG_GENER_ROOT", str(pathlib.Path(__file__).resolve().parent.parent))).resolve()
AWESOME_REPO_URL = os.environ.get("AWESOME_PROMPT_REPO_URL", "https://github.com/freestylefly/awesome-gpt-image-2.git")
AWESOME_REPO_DIR = pathlib.Path(os.environ.get("AWESOME_PROMPT_REPO_DIR", str(APP_ROOT / ".cache" / "awesome-gpt-image-2"))).resolve()
BANANA_REPO_URL = os.environ.get("BANANA_PROMPT_REPO_URL", "https://github.com/glidea/banana-prompt-quicker.git")
BANANA_REPO_DIR = pathlib.Path(os.environ.get("BANANA_PROMPT_REPO_DIR", str(APP_ROOT / ".cache" / "banana-prompt-quicker"))).resolve()
SKIP_BANANA_NSFW = os.environ.get("SKIP_BANANA_NSFW", "1") != "0"
THUMB_DIR = APP_ROOT / "case-thumbs"
LOCK_FILE = APP_ROOT / ".sync_prompt_assets.lock"


def main():
    lock_fd = acquire_lock()
    try:
        ensure_repo(AWESOME_REPO_URL, AWESOME_REPO_DIR)
        ensure_repo(BANANA_REPO_URL, BANANA_REPO_DIR)
        THUMB_DIR.mkdir(parents=True, exist_ok=True)
        templates = parse_templates(AWESOME_REPO_DIR / "docs" / "templates.md")
        awesome_cases = parse_awesome_cases(AWESOME_REPO_DIR)
        banana_cases = parse_banana_cases(BANANA_REPO_DIR, number_start=len(awesome_cases) + 1)
        converted = convert_case_images(awesome_cases + banana_cases)
        write_json(APP_ROOT / "prompt-templates.json", source_payload(), templates, "templates")
        write_json(APP_ROOT / "prompt-cases.json", {**source_payload(), "imageMode": "local-webp"}, converted, "cases")
        print(json.dumps({
            "templates": len(templates),
            "awesome_cases": len(awesome_cases),
            "banana_cases": len(banana_cases),
            "cases": len(converted),
            "thumb_dir": str(THUMB_DIR),
        }, ensure_ascii=False))
    finally:
        os.close(lock_fd)
        try:
            LOCK_FILE.unlink()
        except FileNotFoundError:
            pass


def acquire_lock():
    APP_ROOT.mkdir(parents=True, exist_ok=True)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    try:
        fd = os.open(LOCK_FILE, flags, 0o644)
    except FileExistsError:
        age = time.time() - LOCK_FILE.stat().st_mtime
        if age < 1800:
            raise SystemExit("sync already running")
        LOCK_FILE.unlink()
        fd = os.open(LOCK_FILE, flags, 0o644)
    os.write(fd, str(os.getpid()).encode("utf-8"))
    return fd


def ensure_repo(repo_url, repo_dir):
    if (repo_dir / ".git").exists():
        run(["git", "-C", str(repo_dir), "fetch", "--depth", "1", "origin"])
        run(["git", "-C", str(repo_dir), "reset", "--hard", "origin/main"])
        return
    repo_dir.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "clone", "--depth", "1", repo_url, str(repo_dir)])


def parse_templates(path):
    text = path.read_text(encoding="utf-8")
    templates = []
    for heading in re.finditer(r"^### (.+)$", text, re.M):
        category = heading.group(1).strip()
        start = heading.end()
        next_heading = re.search(r"^### .+$", text[start:], re.M)
        end = start + next_heading.start() if next_heading else len(text)
        section = text[start:end]
        for block in re.finditer(r"```(text|json)\n(.*?)\n```", section, re.S):
            before = section[:block.start()]
            labels = re.findall(r"\*\*([^*]+)\*\*\s*$", before, re.M)
            title = labels[-1].strip() if labels else ("JSON 模板" if block.group(1) == "json" else "常规模板")
            templates.append({
                "id": f"tpl-{len(templates) + 1}",
                "category": category,
                "title": title,
                "kind": block.group(1),
                "prompt": block.group(2).strip(),
            })
    return templates


def parse_awesome_cases(repo_dir):
    cases = []
    for rel in ("docs/gallery-part-1.md", "docs/gallery-part-2.md"):
        path = repo_dir / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        anchors = list(re.finditer(r'<a name="case-(\d+)"></a>', text))
        for index, anchor in enumerate(anchors):
            start = anchor.start()
            end = anchors[index + 1].start() if index + 1 < len(anchors) else len(text)
            section = text[start:end]
            number = int(anchor.group(1))
            title_match = re.search(r"^### 例 \d+：(.+?)\s*$", section, re.M)
            image_match = re.search(r"!\[(.*?)\]\((\.\./data/images/[^)]+)\)", section)
            prompt_match = re.search(r"\*\*提示词：\*\*\s*\n\s*```text\n(.*?)\n```", section, re.S)
            if not title_match or not image_match or not prompt_match:
                continue
            image_path = image_match.group(2).replace("../", "")
            cases.append({
                "id": f"awesome-case-{number}",
                "number": number,
                "title": title_match.group(1).strip(),
                "alt": image_match.group(1).strip(),
                "source": "awesome-gpt-image-2",
                "source_image": str(repo_dir / image_path),
                "thumb_name": f"case{number}.webp",
                "prompt": prompt_match.group(1).strip(),
            })
    return sorted(cases, key=lambda item: item["number"])


def parse_banana_cases(repo_dir, number_start):
    path = repo_dir / "prompts.json"
    if not path.exists():
        return []
    items = json.loads(path.read_text(encoding="utf-8"))
    cases = []
    for index, item in enumerate(items, start=1):
        if SKIP_BANANA_NSFW and item.get("category") == "NSFW":
            continue
        preview = str(item.get("preview") or "").strip()
        prompt = str(item.get("prompt") or "").strip()
        title = str(item.get("title") or f"Banana Prompt {index}").strip()
        if not preview or not prompt:
            continue
        number = number_start + len(cases)
        cases.append({
            "id": f"banana-case-{index}",
            "number": number,
            "title": title,
            "alt": title,
            "source": "banana-prompt-quicker",
            "source_image": resolve_banana_preview(repo_dir, preview, index),
            "thumb_name": f"banana-{index}.webp",
            "prompt": prompt,
            "mode": item.get("mode") or "",
            "category": item.get("category") or "",
            "sub_category": item.get("sub_category") or "",
            "author": item.get("author") or "",
        })
    return cases


def convert_case_images(cases):
    converted = []
    for item in cases:
        source = get_source_image(item["source_image"], item["thumb_name"])
        target = THUMB_DIR / item["thumb_name"]
        if not source or not source.exists():
            continue
        if not target.exists() or source.stat().st_mtime > target.stat().st_mtime:
            tmp = target.with_suffix(".tmp.webp")
            convert_to_webp(source, tmp)
            tmp.replace(target)
        copied = {key: value for key, value in item.items() if key not in {"source_image", "thumb_name"}}
        copied["image"] = f"/case-thumbs/{item['thumb_name']}"
        converted.append(copied)
    return converted


def resolve_banana_preview(repo_dir, preview, index):
    parsed = urllib.parse.urlparse(preview)
    match = re.search(r"/images/([^/?#]+)", parsed.path)
    if match:
        local = repo_dir / "images" / urllib.parse.unquote(match.group(1))
        if local.exists():
            return str(local)
    return preview


def get_source_image(source_image, thumb_name):
    if source_image.startswith("http://") or source_image.startswith("https://"):
        return download_source_image(source_image, thumb_name)
    return pathlib.Path(source_image)


def download_source_image(url, thumb_name):
    source_dir = APP_ROOT / ".cache" / "remote-preview-images"
    source_dir.mkdir(parents=True, exist_ok=True)
    suffix = guess_image_suffix(url)
    target = source_dir / f"{pathlib.Path(thumb_name).stem}{suffix}"
    if target.exists() and target.stat().st_size > 0:
        return target
    for candidate_url in candidate_preview_urls(url):
        request = urllib.request.Request(candidate_url, headers={"User-Agent": "ImgGenerPromptSync/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                data = response.read(12 * 1024 * 1024)
            if not data:
                continue
            target.write_bytes(data)
            return target
        except Exception as error:
            print(f"skip preview download: {candidate_url} ({error})", file=sys.stderr)
    return None


def candidate_preview_urls(url):
    urls = [url]
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc == "camo.githubusercontent.com":
        encoded = parsed.path.strip("/").split("/", 1)[-1]
        try:
            decoded = bytes.fromhex(encoded).decode("utf-8")
            if decoded.startswith(("http://", "https://")):
                urls.append(decoded)
        except ValueError:
            pass
    return urls


def guess_image_suffix(url):
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.lower()
    for suffix in (".jpg", ".jpeg", ".png", ".webp"):
        if path.endswith(suffix):
            return ".jpg" if suffix == ".jpeg" else suffix
    query = urllib.parse.parse_qs(parsed.query)
    fmt = str(query.get("format", [""])[0]).lower()
    if fmt in {"jpg", "jpeg", "png", "webp"}:
        return ".jpg" if fmt == "jpeg" else f".{fmt}"
    return ".img"


def convert_to_webp(source, target):
    try:
        run(["cwebp", "-quiet", "-resize", "640", "0", "-q", "72", str(source), "-o", str(target)])
        return
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass
    from PIL import Image
    with Image.open(source) as image:
        image.thumbnail((640, 640))
        image.convert("RGB").save(target, "WEBP", quality=72, method=6)


def write_json(path, source, data, data_key):
    payload = json.dumps({"source": source, data_key: data}, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(path)


def source_payload():
    return {
        "name": "combined-prompt-gallery",
        "license": "MIT",
        "sources": [
            {
                "name": "awesome-gpt-image-2",
                "url": "https://github.com/freestylefly/awesome-gpt-image-2",
                "copyright": "Copyright (c) 2026 freestylefly",
            },
            {
                "name": "banana-prompt-quicker",
                "url": "https://github.com/glidea/banana-prompt-quicker",
                "copyright": "Copyright (c) 2025 glidea",
                "skip_nsfw": SKIP_BANANA_NSFW,
            },
        ],
    }


def run(command):
    subprocess.run(command, check=True)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(f"command failed: {error.cmd}", file=sys.stderr)
        raise
