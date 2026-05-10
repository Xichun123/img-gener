#!/usr/bin/env python3
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEYS_FILE = ROOT / 'keys.json'


def main():
    while True:
        keys = load_keys()
        print('\n=== Key 管理 ===')
        print('1. 查看全部 key')
        print('2. 新增 key')
        print('3. 修改次数')
        print('4. 重置已用次数')
        print('5. 启用/禁用 key')
        print('6. 删除 key')
        print('0. 退出')
        choice = input('请选择操作：').strip()
        if choice == '0':
            return
        if choice == '1':
            list_keys(keys)
        elif choice == '2':
            create_key(keys)
        elif choice == '3':
            update_limit(keys)
        elif choice == '4':
            reset_used(keys)
        elif choice == '5':
            toggle_key(keys)
        elif choice == '6':
            delete_key(keys)
        else:
            print('无效选项。')


def create_key(keys):
    print('\n创建方式：')
    print('1. 随机生成')
    print('2. 自定义输入')
    mode = input('请选择创建方式（默认 1）：').strip() or '1'
    if mode == '2':
        name = ask_required('请输入自定义 key：')
    else:
        name = f"key_{secrets.token_hex(8)}"
    if name in keys:
        print('这个 key 已存在。')
        return
    limit = ask_positive_int('可用次数', 10)
    expires_at = input('过期时间 ISO，可留空，例如 2026-12-31T23:59:59Z：').strip()
    keys[name] = {
        'limit': limit,
        'used': 0,
        'enabled': True,
        'createdAt': now_iso(),
    }
    if expires_at:
        keys[name]['expiresAt'] = expires_at
    save_keys(keys)
    print(f'已创建：{name}，次数 {limit}')


def update_limit(keys):
    name = choose_key(keys)
    if not name:
        return
    old = keys[name].get('limit', 0)
    keys[name]['limit'] = ask_positive_int(f'新的总次数（当前 {old}）', old)
    keys[name]['updatedAt'] = now_iso()
    save_keys(keys)
    print(f'已更新：{name}')


def reset_used(keys):
    name = choose_key(keys)
    if not name:
        return
    keys[name]['used'] = ask_non_negative_int('设置已用次数', 0)
    keys[name]['updatedAt'] = now_iso()
    save_keys(keys)
    print(f'已更新：{name}')


def toggle_key(keys):
    name = choose_key(keys)
    if not name:
        return
    keys[name]['enabled'] = not keys[name].get('enabled', True)
    keys[name]['updatedAt'] = now_iso()
    save_keys(keys)
    print(f"已{'启用' if keys[name]['enabled'] else '禁用'}：{name}")


def delete_key(keys):
    name = choose_key(keys)
    if not name:
        return
    if input(f'确认删除 {name}？输入 yes 确认：').strip() != 'yes':
        print('已取消。')
        return
    keys.pop(name, None)
    save_keys(keys)
    print(f'已删除：{name}')


def list_keys(keys):
    if not keys:
        print('暂无 key。')
        return
    print(f"{'key':<28} {'enabled':<8} {'limit':<8} {'used':<8} {'remain':<8} expiresAt")
    for name, item in keys.items():
        limit = int(item.get('limit', 0))
        used = int(item.get('used', 0))
        print(f"{name:<28} {str(item.get('enabled', True)):<8} {limit:<8} {used:<8} {max(limit-used, 0):<8} {item.get('expiresAt', '')}")


def choose_key(keys):
    list_keys(keys)
    if not keys:
        return ''
    name = input('输入 key 名称：').strip()
    if name not in keys:
        print('key 不存在。')
        return ''
    return name


def ask_required(prompt):
    while True:
        value = input(prompt).strip()
        if value:
            return value
        print('不能为空。')


def ask_positive_int(prompt, default):
    while True:
        raw = input(f'{prompt}（默认 {default}）：').strip()
        if not raw:
            return int(default)
        if raw.isdigit() and int(raw) > 0:
            return int(raw)
        print('请输入大于 0 的整数。')


def ask_non_negative_int(prompt, default):
    while True:
        raw = input(f'{prompt}（默认 {default}）：').strip()
        if not raw:
            return int(default)
        if raw.isdigit():
            return int(raw)
        print('请输入不小于 0 的整数。')


def load_keys():
    if not KEYS_FILE.exists():
        return {}
    return json.loads(KEYS_FILE.read_text(encoding='utf-8'))


def save_keys(keys):
    payload = json.dumps(keys, ensure_ascii=False, indent=2) + '\n'
    tmp = KEYS_FILE.with_suffix(KEYS_FILE.suffix + '.tmp')
    tmp.write_text(payload, encoding='utf-8')
    os.replace(tmp, KEYS_FILE)


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


if __name__ == '__main__':
    main()
