# Img Gener

Img Gener 是一个自托管 AI 生图网站。浏览器只填写你分发的网站 Key，真实上游 API Base URL 和真实 API Key 只保存在服务端 `.env`，不会暴露给前端。

## 功能

- 文生图：支持单模型或多模型并发生成。
- 图生图 / 图片编辑：支持上传图片后编辑，也支持对生成结果继续编辑。
- 数量控制：单模型最多 4 张，单次请求总量最多 6 张。
- 网站 Key：支持限制次数、重置已用次数、启用/禁用、过期时间。
- 提示词图库：内置提示词模板和效果图图库，点击效果图可自动填入提示词。
- 上游隐藏：前端只请求本站 `/api/generate` 和 `/api/edit`，真实上游配置在后端代理层。
- 静态部署友好：后端只依赖 Python 标准库即可启动核心功能。

## 支持模型

当前内置模型：

- `gpt-image-2`
- `gemini-3-pro-image-preview`
- `gemini-3.1-flash-image-preview`

当前内置尺寸：

- `auto`
- `1024x1024`
- `1024x1536`
- `1536x1024`
- `1792x1024`
- `1024x1792`
- `2048x2048`
- `2048x3072`
- `3072x2048`
- `3840x2160`
- `2160x3840`

> 实际可用尺寸仍取决于你的上游 API 提供商；不同模型可能并不完全一致。

## 快速开始

复制配置模板：

```bash
cp .env.example .env
cp keys.example.json keys.json
```

编辑 `.env`：

```dotenv
PORT=5173
UPSTREAM_BASE_URL=https://api.example.com
UPSTREAM_API_KEY=replace-with-real-upstream-key
SITE_KEYS_FILE=keys.json
UPSTREAM_TIMEOUT=600
```

启动服务：

```bash
python3 server.py
```

打开：

```text
http://127.0.0.1:5173
```

也可以使用 npm 脚本包装：

```bash
npm start
```

## 网站 Key 管理

运行交互式脚本：

```bash
python3 scripts/key_manager.py
```

或：

```bash
npm run keys
```

支持操作：

- 查看全部 Key
- 随机生成 Key
- 自定义创建 Key
- 修改总次数
- 重置已用次数
- 启用 / 禁用 Key
- 删除 Key
- 设置可选过期时间

`keys.json` 是运行时敏感文件，默认已写入 `.gitignore`，不要提交真实 Key 数据。

## 提示词图库同步

项目可以从以下公开仓库同步提示词和效果图，并生成本地 WebP 缩略图：

- [awesome-gpt-image-2](https://github.com/freestylefly/awesome-gpt-image-2)
- [banana-prompt-quicker](https://github.com/glidea/banana-prompt-quicker)

安装可选依赖：

```bash
python3 -m pip install -r requirements.txt
```

如果系统已安装 `cwebp`，脚本会优先使用 `cwebp`；否则使用 `Pillow` 作为兜底。

执行同步：

```bash
python3 scripts/sync_prompt_assets.py
```

默认会跳过 `banana-prompt-quicker` 的 NSFW 分类：

```dotenv
SKIP_BANANA_NSFW=1
```

如果你确实要同步 NSFW 分类，可以在环境变量中改成：

```bash
SKIP_BANANA_NSFW=0 python3 scripts/sync_prompt_assets.py
```

## VPS 部署

推荐部署目录：

```bash
/opt/img-gener
```

基础步骤：

```bash
git clone https://github.com/YOUR_NAME/img-gener.git /opt/img-gener
cd /opt/img-gener
cp .env.example .env
cp keys.example.json keys.json
python3 -m pip install -r requirements.txt
python3 server.py
```

### systemd

复制服务模板：

```bash
sudo cp deploy/img-gener.service.example /etc/systemd/system/img-gener.service
sudo systemctl daemon-reload
sudo systemctl enable --now img-gener
```

查看状态：

```bash
sudo systemctl status img-gener
```

### Caddy 反代

参考 `deploy/Caddyfile.example`：

```caddyfile
img-gener.example.com {
	encode zstd gzip
	request_body {
		max_size 500MB
	}
	reverse_proxy 127.0.0.1:5173 {
		flush_interval -1
		transport http {
			response_header_timeout 11m
			dial_timeout 10s
		}
	}
}
```

`response_header_timeout` 建议大于 `UPSTREAM_TIMEOUT`，避免长时间生图请求先被反代断开。

### 定时同步提示词图库

复制 timer 模板：

```bash
sudo cp deploy/img-gener-prompts-sync.service.example /etc/systemd/system/img-gener-prompts-sync.service
sudo cp deploy/img-gener-prompts-sync.timer.example /etc/systemd/system/img-gener-prompts-sync.timer
sudo systemctl daemon-reload
sudo systemctl enable --now img-gener-prompts-sync.timer
```

查看执行记录：

```bash
sudo journalctl -u img-gener-prompts-sync.service -n 100 --no-pager
```

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5173` | 本地监听端口，仅监听 `127.0.0.1` |
| `UPSTREAM_BASE_URL` | 无 | 上游 OpenAI-compatible API 地址 |
| `UPSTREAM_API_KEY` | 无 | 真实上游 API Key |
| `SITE_KEYS_FILE` | `keys.json` | 网站 Key 数据文件 |
| `UPSTREAM_TIMEOUT` | `600` | 单个上游请求超时时间，单位秒 |
| `IMG_GENER_ROOT` | 当前项目目录 | 提示词图库同步根目录 |
| `AWESOME_PROMPT_REPO_URL` | 官方仓库 URL | awesome-gpt-image-2 来源 |
| `BANANA_PROMPT_REPO_URL` | 官方仓库 URL | banana-prompt-quicker 来源 |
| `SKIP_BANANA_NSFW` | `1` | 是否跳过 NSFW 分类 |

## 项目结构

```text
.
├── app.js                         # 前端交互逻辑
├── index.html                     # 生成页
├── gallery.html                   # 效果图图库页
├── prompt-gallery.js              # 图库点击填充逻辑
├── prompt-templates.js            # 提示词模板数据
├── prompt-cases.js                # 效果图案例数据
├── case-thumbs/                   # 本地 WebP 效果图缩略图
├── server.py                      # Python 后端代理
├── scripts/key_manager.py         # 网站 Key 管理脚本
├── scripts/sync_prompt_assets.py  # 提示词图库同步脚本
├── deploy/                        # systemd / Caddy 示例
├── .env.example                   # 环境变量模板
└── keys.example.json              # 网站 Key 模板
```

## 安全说明

- 不要提交 `.env`。
- 不要提交真实 `keys.json`。
- 不要把真实上游 API Key 写进前端代码。
- 网站 Key 只能限制本站使用次数，不能替代上游账单限制。
- 公开部署时建议配合 CDN / WAF / 反代限流。
- 如果上游 API 支持预算、速率、来源限制，应同时在上游侧开启。

## 第三方素材

提示词和预览图来源见 `THIRD_PARTY_NOTICES.md`。项目默认跳过 NSFW 分类。
