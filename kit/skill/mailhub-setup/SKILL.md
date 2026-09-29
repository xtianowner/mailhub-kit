---
name: mailhub-setup
description: 从零为用户搭建并运维自己的域名邮箱 MailHub：Cloudflare 收信（任意前缀@用户域名）+ 带密码登录的云端网页 + 本机一键启动的本地版。用户只需准备 Cloudflare 账号和一个域名；环境缺什么由你补齐。触发：搭建域名邮箱 / 部署 MailHub / mailhub setup / 启动或停止本地邮箱 / 改邮箱登录密码 / 邮箱收不到信排查。
---

# MailHub 搭建与运维

你是用户的执行者。目标：**用户只回答一次问询**，其余全部由你完成，最后交给用户一份可用的结果。
所有命令在**项目根**执行：macOS / Linux 为 `~/mailhub-kit`，Windows 为 `%USERPROFILE%\mailhub-kit`。

## 0. 红线（任何情况都不做）

- **不让用户在聊天里发密码**。登录密码只在第 4 节弹出的终端窗口里由用户本人输入。
- **不读取、不打印** `.mailhub/generated/.dev.vars`（里面是接口密钥）；不把任何密钥写进聊天、日志或其它文件。
- **不删除**用户的 DNS 记录、域名、Email Routing 规则、Worker、数据库。脚本停下来要求用户决定的事，你只转述，不替用户拍板。
- `--allow-existing-mx`、`--take-over-catch-all`、`--take-over-host`、`--reuse-workers` 这四个放行参数，只有在用户**针对那一条提示明确同意**后才能加（对照表见第 3 节），不能预先加上。
- 不伪造结果：没有真实输出证明，就不说「已完成」。

## 1. 找到项目、补齐环境（对用户透明，不打扰）

1. 若项目根不存在：把用户给你的压缩包解压、或把仓库克隆到项目根。之后始终在项目根执行命令。
2. `node -v`。没有 Node，或主版本 < 22，就帮用户安装 Node.js 22 LTS：
   - macOS：从 https://nodejs.org 下载 LTS 的 .pkg 安装（最省心）；或有 Homebrew 时 `brew install node@22 && brew link --overwrite --force node@22`（会替换用户已有的 node 链接，事后告诉用户）。
   - Windows：`winget install OpenJS.NodeJS.LTS`，装完新开一个终端。
   - Linux：用 nvm：`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`，然后 `nvm install 22`。
   - 装 Node 若需要管理员密码，请用户在自己的终端里执行那一条命令。
3. `node kit/scripts/doctor.mjs` → 退出码 0 即可继续。`cloudflare_api` 不通：请用户确认网络，需要代理时在当前终端设置 `HTTPS_PROXY`。
4. `node kit/scripts/setup.mjs deps`（安装依赖，首次 1–3 分钟）。国内网络失败时重跑并加 `--registry https://registry.npmmirror.com`。

## 2. 一次性问询（整个流程里唯一需要用户回答问题的地方）

把下面这段**原样**发给用户（可按用户语气微调，不要删项），等用户一次答完：

> 我来帮你搭一套自己的域名邮箱。做完后你会有：
> ① 一个登录网页（比如 mail.你的域名），手机、电脑都能登录收信；
> ② 本机一个同样的网页，一条命令启动，不用登录；
> ③ 任意名字@你的域名 都能收信，注册账号、接验证码很方便。
> 全部跑在你自己的 Cloudflare 免费账号上，不花钱。
>
> 请先准备好：一个 Cloudflare 账号（没有就去 https://dash.cloudflare.com 免费注册），和一个域名。然后一次回答这几个问题：
> 1. 你的域名是？（例：example.com）
> 2. 这个域名现在有没有在用别的邮箱（比如企业邮箱、QQ 域名邮箱）？有的话，接入后那边会收不到信。
> 3. 登录网页想用什么地址？必须是这个域名下的子域名，挑一个好记的，以后就用它登录。（例：mail.example.com）
> 4. 登录用户名用什么？建议用你常用的邮箱（例：you@gmail.com）。**密码不用现在告诉我**，稍后会弹出一个窗口让你自己输入，不经过聊天。
> 5. 需要「数据接口」做二次开发吗？一般不需要。不需要我就用默认地址 api-mail.你的域名（系统内部也要用它）；需要的话告诉我想要的地址。
> 6. 要保存邮件附件吗？需要在 Cloudflare 绑定信用卡或 PayPal 开通 R2（有 10GB 免费额度）。默认不保存，以后想开再说。
>
> 之后你只需要再做几件小事，到时我会提醒你：浏览器弹出 Cloudflare 授权页时点「允许」；如果域名还没接入 Cloudflare，按我给的步骤改一次域名的 NS；在弹出的终端窗口里设置登录密码。全部搭好后，你用自己的 Gmail / QQ 邮箱发一封信到 test@你的域名 试一下就行。

处理回答：
- 第 2 题答「有」：说明后果，请用户在「换一个没在用的域名」和「确认放弃原邮箱」之间选。确认放弃，后面遇到 MX 冲突时才加 `--allow-existing-mx`。
- 第 3 / 5 题的地址不是该域名的子域名：请用户换一个。
- 得到答案后执行（没要二次开发就不加 `--api-host`；要保存附件才加 `--attachments`）：

```
node kit/scripts/setup.mjs init --domain <域名> --web-host <登录网页地址> --login-user <用户名> [--api-host <数据接口地址>] [--attachments]
node kit/scripts/setup.mjs plan
```

`plan` 的输出就是即将创建的清单，简要告诉用户「我开始了」，然后直接进入第 3 节，不需要等用户确认。

## 3. 执行搭建（逐步运行，每步都可安全重跑）

按顺序**一次运行一个步骤**：`node kit/scripts/setup.mjs <步骤>`。单步可能要跑几分钟，请把命令超时设到你能设的最大值（至少 10 分钟）。

| 顺序 | 步骤 | 做什么 | 注意 |
|---|---|---|---|
| 1 | `login` | 登录 Cloudflare | 有图形界面时会打开浏览器，先告诉用户「请在弹出的页面点允许」；远程 / 无图形界面会返回 10，并给出链接和验证码，见下方 |
| 2 | `zone` | 确认域名已接入 Cloudflare | 见下方「退出码 10」 |
| 3 | `preflight` | 检查会不会覆盖用户已有的东西：别处的邮箱、兜底规则、两个网址、同名 Worker | 冲突时停下，让用户决定 |
| 4 | `d1` | 建数据库、建表、登记域名 | |
| 5 | `r2` | 附件存储（没选附件会自动跳过） | |
| 6 | `configs` | 生成部署配置和随机密钥 | 随机密钥自动生成，不用问用户 |
| 7 | `deploy-inbox` | 部署收信程序 | |
| 8 | `deploy-api` | 部署数据接口，等它上线 | 新地址首次签发证书可能要几分钟 |
| 9 | `build` | 构建网页 | |
| 10 | `deploy-web` | 部署登录网页，等它上线 | |
| 11 | `routing` | 开启收信路由，任意前缀的来信都交给收信程序 | |
| 12 | `local` | 启动本地版 | |
| 13 | `password` | 设置登录密码 | 见第 4 节 |
| 14 | `verify` | 全链路验收 | 见第 5 节 |

**按退出码处理**（每条命令结束后看退出码，不要只看文字）：

- `0`：成功，进入下一步。
- `10`：**需要用户本人操作**。把输出里「🙋 请你操作」那段用大白话转告用户，等用户说好了再重跑**同一步**。
  - `zone` 报域名未接入：用户在 Cloudflare 添加域名后，页面会给出两个 NS，用户要去买域名的平台改 NS。改好后运行 `node kit/scripts/setup.mjs zone --wait 8`，它每 30 秒查一次、最多等 8 分钟；超时就再运行一次，NS 生效有时要几小时，期间可以让用户先去忙别的。
  - `login` 返回链接和验证码：把两者原样发给用户，请他在任意设备（手机也行）的浏览器打开链接、输入验证码。用户说好了再重跑 `login`。
  - `preflight` / `routing` 的冲突提示：把提示转述给用户，按用户的回答处理：

    | 提示 | 用户回答 | 你做 |
    |---|---|---|
    | 域名有别的邮箱在收信 | 确认放弃原邮箱 | 重跑时加 `--allow-existing-mx` |
    | 已有兜底规则指向别处 | 确认接管 | 重跑时加 `--take-over-catch-all` |
    | 网址已有 DNS 记录 / 已绑定别的 Worker | 确认占用 | 重跑时加 `--take-over-host` |
    | 网址冲突 | 给了新地址 | 用新地址重新 `init`，从 `preflight` 起重跑 |
    | 已有同名 Worker | 是我之前建的 | 重跑时加 `--reuse-workers` |
    | 已有同名 Worker | 给了新前缀 | `init` 时加 `--prefix <新前缀>`，从 `preflight` 起重跑 |
    | 无法确认（查询失败） | — | 稍等后重跑，不加任何放行参数 |

    用户同意一次就会被记住（绑定当时的域名 / 地址 / 前缀），之后重跑不用再加；换了域名或地址会重新提示。
- `1`：失败。读「失败」和「下一步」，按提示修复后重跑同一步。**同一步最多重试 2 次**，仍失败就把原始报错和你的判断告诉用户，不要继续往后跑，也不要删除任何线上资源来「重来」。
- `2`：配置不合法。按提示修正（通常是重新 `init`），再从出错的那一步继续。

常见失败：

| 现象 | 处理 |
|---|---|
| `deploy-api` / `deploy-web` 等上线超时 | 证书还在签发。过 2–3 分钟重跑同一步 |
| `routing` 报没能自动开启 | 按输出提示请用户在 Cloudflare 网页上点一次启用，再重跑 |
| `npm ci` 失败或极慢 | `node kit/scripts/setup.mjs deps --registry https://registry.npmmirror.com` |
| 连不上 Cloudflare 接口 | 网络问题。国内如需代理，请用户开代理，并在终端设置 `HTTPS_PROXY` 后重跑 |

## 4. 设置登录密码（human-in-loop）

运行 `node kit/scripts/setup.mjs password` 前先告诉用户：「马上会弹出一个终端窗口，请在里面设置登录密码（输入时不显示，要输两次）。」

- 这条命令会自动弹出终端窗口，并等待最多 8 分钟，设置好就自动继续。
- 没弹出窗口（比如远程机器、没有图形界面）：输出里会给一条命令，请用户在**他自己的**终端里执行。
- 超时（退出码 10）：提醒用户后重跑同一步。
- 用户忘记密码、想改密码：让用户自己运行 `node kit/scripts/set-login.mjs`。

## 5. 验收与交付

运行 `node kit/scripts/verify.mjs`，退出码必须是 0（10 项检查全部 ✅）。然后把输出末尾「交付信息」那段整理后告诉用户，要包含：

- 云端登录网页地址和用户名；
- 本地版地址，以及启动、停止方法：macOS / Linux 用项目根的 `./start.sh` 和 `./stop.sh`，Windows 用 `start.cmd` 和 `stop.cmd`；
- 请用户**自己测试一次**：用 Gmail / QQ 等邮箱发一封信到 `test@<域名>`，一分钟内登录网页就能看到。

有任何一项 ❌ 时，不要说「完成」。按那一项的提示处理后重跑 `verify`。

## 6. 日常操作（用户以后找你时）

| 用户说 | 你做 |
|---|---|
| 启动 / 打开本地邮箱 | `node kit/scripts/local.mjs start --open` |
| 停止本地邮箱 | `node kit/scripts/local.mjs stop` |
| 本地邮箱在运行吗 | `node kit/scripts/local.mjs status` |
| 改登录密码 | 请用户自己在终端运行 `node kit/scripts/set-login.mjs` |
| 收不到信 | `node kit/scripts/verify.mjs`，按失败项处理 |
| 更新到新版本 | 在项目根执行 `git pull`；把 `kit/skill/mailhub-setup/` 重新复制到你的 skills 目录（覆盖旧版）；再从 `deps` 开始把各步重跑一遍（已完成的会自动跳过或原样覆盖） |

## 7. 关于这套系统（回答用户疑问时用）

- 三个 Cloudflare Worker：`<前缀>-inbox` 收信，`<前缀>-api` 数据接口，`<前缀>-web` 登录网页；外加一个 D1 数据库 `<前缀>-db`。前缀默认是 `mailhub`。
- 来信的路径：外部邮件 → Cloudflare Email Routing 的兜底规则 → `<前缀>-inbox` 解析，存入 D1 → 网页通过 `<前缀>-api` 读取。
- 用户要做二次开发时，接口说明在项目根的 `kit/docs/data-api.md`。
- 本地版网页只接受本机页面自己发起的修改请求，别的网站想借用户浏览器偷偷操作会被拒绝（403）。
- 本地版就是在本机运行的同一个登录网页，只允许本机访问、免登录，数据和云端是同一份。
- 费用：收信、Worker、D1 都在 Cloudflare 免费额度内。R2 附件存储有 10GB 免费额度，开通需要绑卡。对外发信需要 Workers 付费版（5 美元/月），本套件默认不开。
