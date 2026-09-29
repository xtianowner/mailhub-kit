<!-- purpose: MailHub Kit 对外说明：是什么、要准备什么、怎么交给 AI 一次搭好、日常怎么用。 -->

# MailHub Kit

在你自己的 Cloudflare 免费账号上搭一套**自己的域名邮箱**：

- ☁️ **云端登录网页**：比如 `https://mail.你的域名`，手机、电脑随时登录收信，账号密码保护。
- 💻 **本地版**：本机一条命令启动同一个网页，只允许本机访问，免登录。
- 📮 **任意前缀收信**：`任意名字@你的域名` 都能收到信，第一次来信自动建信箱，并自动提取验证码。

不用买服务器，不用维护邮件服务器，Cloudflare 免费额度内零成本。

## 你需要准备

1. 一个 **Cloudflare 账号**（没有就去 https://dash.cloudflare.com 免费注册）
2. 一个**域名**（在哪买的都行；这个域名最好没在用别的邮箱）
3. 一台电脑，外加一个 AI 编程工具：Claude Code、Codex、Hermes Agent 都可以。电脑缺什么环境，AI 会帮你装。

## 怎么用：交给你的 AI，一句话搞定

把这个项目（文件夹或压缩包）交给你的 AI 工具，然后发这一句：

> 请阅读 mailhub-kit 里的 AGENTS.md，按它帮我搭建域名邮箱。

AI 会先把自己注册成 `mailhub-setup` 技能，然后**一次性问你几个问题**：域名、登录网页地址、登录用户名等，接着自动完成全部搭建。

这个 AI 助手是一次性的，它只有一个目标：**把你的邮箱搭建成功**。

- 中途卡住了，它会用大白话告诉你卡在哪、需要你做什么，然后换办法继续，直到搭通为止。
- 关掉工具再回来，说一句「继续搭建我的邮箱」，它会从上次停下的地方接着做。
- 搭建过程中或搭好之后，你想调整网页样式、换地址、开启附件，也可以直接跟它说。

过程中你只需要：

- 浏览器弹出 Cloudflare 授权页时，点「允许」；
- 如果域名还没接入 Cloudflare，按提示去买域名的平台改一次 NS；
- 在弹出的终端窗口里设置登录密码（密码不经过聊天）。

搭好后，请你亲自确认三件事：
1. 能用自己的密码登录网页；
2. 用 Gmail / QQ 邮箱发一封信到 `test@你的域名`，一分钟内能在网页里看到；
3. 本地版能打开。

三件事都确认了才算完成。完成之后，日常使用就不需要 AI 助手了。

## 日常使用

| 想做什么 | 怎么做 |
|---|---|
| 启动本地版 | 运行 `./start.sh`（Windows：双击 `start.cmd`），会自动打开浏览器 |
| 停止本地版 | 运行 `./stop.sh`（Windows：双击 `stop.cmd`） |
| 改登录密码 | `node kit/scripts/set-login.mjs` |
| 其它事 | 跟你的 AI 说，比如「启动我的邮箱」「邮箱收不到信了帮我查一下」 |

## 费用

| 项目 | 费用 |
|---|---|
| 收信、网页、数据接口、数据库 | Cloudflare 免费额度内：后台每天 10 万次请求，数据库 5GB |
| 保存附件（可选） | R2 有 10GB 免费额度，开通需要在 Cloudflare 绑定信用卡或 PayPal |
| 对外发信（默认不开） | 需要 Workers 付费版，5 美元/月 |

## 不用 AI、自己动手

需要 Node.js 22 或更高版本。在项目根依次执行：

```bash
node kit/scripts/doctor.mjs                 # 环境自检
node kit/scripts/setup.mjs deps             # 安装依赖
node kit/scripts/setup.mjs init --domain example.com --web-host mail.example.com --login-user you@gmail.com
node kit/scripts/setup.mjs all              # 跑完全部步骤；遇到需要你操作的地方会停下来说明
node kit/scripts/verify.mjs                 # 全链路验收
```

每一步都可以安全重跑，已经完成的会自动跳过。完整说明见 `kit/skill/mailhub-setup/SKILL.md`。

## 它是怎么工作的

```
外部来信 → Cloudflare Email Routing（兜底规则）→ mailhub-inbox（解析、提取验证码）→ D1 数据库
                                                                           ↑
浏览器 → mailhub-web（登录网关，服务端注入接口密钥）→ mailhub-api（数据接口）──┘
本机   → 同一个 mailhub-web 在本地运行（免登录，只允许本机访问）
```

| 目录 | 内容 |
|---|---|
| `kit/` | 安装器、agent 技能、离线自测；数据接口说明见 `kit/docs/data-api.md` |
| `modules/cfmail-worker/` | 收信与数据接口两个 Worker，以及数据库升级脚本 |
| `modules/unified-mail/frontend/` | 网页界面（React） |
| `modules/unified-mail/cloud/` | 登录网关 Worker |

## 安全

- 接口密钥由安装器随机生成，只存在 Cloudflare 的加密变量和你本机的 `.mailhub/`（已被 git 忽略、仅本人可读）里。浏览器永远拿不到。
- 登录密码只由你本人在终端里输入，直接加密存到 Cloudflare，本机不留副本。
- 云端网页未登录时，所有数据接口一律拒绝访问。本地免登录只对 `127.0.0.1` 的请求生效。

## 开发者自测

```bash
cd kit && npm ci && npm test && cd ..      # 单元测试
node kit/tests/e2e-local.mjs               # 离线全链路：本地模拟收信 → 数据库 → 接口 → 本地网页
```

## 许可

MIT
