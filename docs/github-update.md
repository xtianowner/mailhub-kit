<!-- purpose: 维护者用的 GitHub 发布资料：仓库简介、Topics、能力清单、发布前验证与安全规则。 -->

# MailHub Kit · GitHub 发布资料

这份文档可直接用于 GitHub 仓库简介、Release 说明和项目维护说明。MailHub Kit 是一个可交付的开源项目，包含部署脚本、Agent Skill、Cloudflare Worker、网页前端和自动化测试。

## 仓库简介

> Open-source Cloudflare domain email deployment agent with a secure web inbox, local mode, registered or automatic mailbox creation, and macOS/Windows/Linux support.

中文简介：

> 开源的 Cloudflare 域名邮箱部署 agent，提供安全网页收件箱、本机免登录版、登记收信与自动建箱两种模式，支持 macOS、Windows 和 Linux。

## 推荐 Topics

```text
mailhub
cloudflare
email-routing
cloudflare-workers
cloudflare-d1
domain-email
temporary-email
verification-code
agent-skill
codex
claude-code
windows
```

## 项目能力

- 使用 Cloudflare Email Routing 接收域名邮件。
- 部署带密码的云端网页收件箱，并提供只监听回环地址的本地版。
- 默认要求先登记收件地址；设置中可以切换到任意前缀自动建箱。
- 收件准入在解析正文和写入数据库之前执行，未知地址不会创建邮箱或保存邮件。
- 提供域名邮箱、验证码提取、邮件详情、备注和分组等网页功能。
- 登录网关提供基于 D1 的 IP 与全局尝试次数限制，达到限制返回 `429` 和 `Retry-After`。
- Windows 启动器使用配置阶段记录的 Node 运行时，保留带空格参数和退出码。
- `mailhub-setup` Agent Skill 能完成环境检查、Cloudflare 授权、资源配置、部署、测试地址登记和验收引导。

## 快速开始

将仓库交给支持 Agent Skills 的 AI 工具，并发送：

```text
请阅读 https://github.com/xtianowner/mailhub-kit 里的 AGENTS.md，按它帮我搭建域名邮箱。
```

手动执行时需要 Node.js 22 或 24 LTS：

```bash
node kit/scripts/doctor.mjs
node kit/scripts/setup.mjs deps
node kit/scripts/setup.mjs init --domain example.com --web-host mail.example.com --login-user you@example.com
node kit/scripts/setup.mjs all
node kit/scripts/setup.mjs prepare-test
node kit/scripts/setup.mjs verify
```

Windows 在 `configs` 完成后可使用：

```powershell
.\mailhub.cmd status
.\mailhub.cmd verify
```

完整流程、授权恢复和安全边界见：

- [`AGENTS.md`](../AGENTS.md)
- [`kit/skill/mailhub-setup/SKILL.md`](../kit/skill/mailhub-setup/SKILL.md)
- [`kit/skill/mailhub-setup/references/platform-auth.md`](../kit/skill/mailhub-setup/references/platform-auth.md)
- [`kit/docs/mail-security.md`](../kit/docs/mail-security.md)
- [`kit/docs/data-api.md`](../kit/docs/data-api.md)

## 收信模式

`registered` 是默认模式。用户先在“域名邮箱”登记地址，只有已登记且启用的地址可以收信。`auto` 模式允许域名下任意前缀首次来信时自动创建邮箱，适合临时地址场景。模式由管理员在设置页保存，云端和本地版共享。

登记模式可以减少随机收件人带来的垃圾邮箱和存储增长，但不能阻止发往已知地址的垃圾邮件，也不能消除所有入口请求消耗。

## 验证

提交前执行：

```bash
cd kit
npm ci
npm test
cd ..
node --test modules/cfmail-worker/tests/*.test.mjs modules/unified-mail/cloud/tests/*.test.mjs
node kit/scripts/setup.mjs build
node kit/tests/e2e-local.mjs
```

GitHub Actions 在 Ubuntu 和 Windows 上使用 Node 22 执行同一套回归流程，配置文件为 [`.github/workflows/test.yml`](../.github/workflows/test.yml)。

## 安全发布规则

- `.mailhub/`、`.dev.vars`、OAuth 令牌、会话密钥、Cloudflare 账号标识和本地运行日志不进入仓库或压缩包。
- 浏览器不接触 Cloudflare 管理密钥；网页通过网关访问数据接口。
- 密码只在用户自己的终端输入，不经 AI 对话传递。
- 本地版只对回环地址开放，并保留跨站写入保护。
- 真实外部邮件和用户确认由用户本人完成，自动化测试使用隔离数据。

## 压缩包内容

发布压缩包包含源码、文档、Agent Skill、Worker、网页前端、迁移、测试和 GitHub Actions 配置。压缩包不包含 `.git`、`node_modules`、构建产物、`.mailhub`、`.wrangler`、日志和任何凭据。
