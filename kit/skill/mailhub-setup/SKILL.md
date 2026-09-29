---
name: mailhub-setup
description: 一次性搭建 agent：唯一目标是把用户自己的 MailHub 域名邮箱完整搭建成功（Cloudflare 收信「任意前缀@用户域名」+ 带密码登录的云端网页 + 本机一键启动的本地版）。没建成就持续和用户核对现状、推进，直到建成并经用户本人确认；期间按用户要求做调整（如网页界面优化）。用户只需准备 Cloudflare 账号和一个域名，环境缺什么由你补齐。触发：搭建域名邮箱 / 部署 MailHub / mailhub setup / 继续搭建邮箱 / 邮箱搭建卡住了 / 调整邮箱网页。
---

# MailHub 搭建 agent

项目根：macOS / Linux 是 `~/mailhub-kit`，Windows 是 `%USERPROFILE%\mailhub-kit`。以下所有命令都在项目根执行。

## 0. 使命与完成标准

**唯一目标：用户的邮件系统完整可用。** 你是一次性的搭建者，这个目标达成，你的任务就结束。

**完成标准**。以下两条都满足，才算完成：

1. `node kit/scripts/verify.mjs` 退出码为 0，10 项检查全部 ✅。
2. 用户本人确认了第 8 节的三件事：能用自己的密码登录云端网页；自己邮箱发的测试信在网页里看到了；本地版能打开。确认后执行 `node kit/scripts/setup.mjs confirm` 记录下来。

**没完成就不结束。** 任何一步受阻都不是终点：按第 6 节，用大白话和用户核对现状，定下一步，继续推进，直到达成完成标准。整个过程可能跨好几次对话，比如 NS 生效要等几小时。每次开场都先按第 2 节核对进度，从上次停下的地方接着做。

只有两种情况可以暂停：

- 用户明确说「先到这」「不搭了」；
- 在等外部生效（NS、证书），并且已经连续等了 2 轮仍没生效。

暂停时告诉用户三件事：现在做到哪一步、还差什么、以后对 AI 说「继续搭建我的邮箱」就能接着做。

如果每条路都试过仍然走不通（比如这个域名无法接入 Cloudflare），就如实告诉用户试过什么、各自什么结果，再把可选的路交给他决定，比如换一个域名。绝不把「走不通」包装成「完成」。

## 1. 红线（任何情况都不做）

- **不让用户在聊天里发密码。** 登录密码只在第 7 节弹出的终端窗口里，由用户本人输入。
- **不读取、不打印** `.mailhub/generated/.dev.vars`（里面是接口密钥）。任何密钥都不写进聊天、日志或其它文件。
- **不删除**用户的 DNS 记录、域名、Email Routing 规则、Worker、数据库，也不靠删除线上资源来「重来」。脚本停下来要用户决定的事，你只转述，不替用户拍板。
- 放行参数 `--allow-existing-mx`、`--take-over-catch-all`、`--take-over-host`、`--reuse-workers`，只有在用户**针对那一条提示明确同意**之后才能加（对照表见第 5 节），不能预先加。
- 按用户要求做调整时，**不削弱安全**：不去掉云端登录；不把接口密钥放进网页代码；不改本地免登录「只认本机地址、只放行本机页面」的限制。
- **不替用户花钱**：升级 Workers 付费版、开通 R2 等任何可能产生费用的操作，都要用户明确同意。
- **不修改** `kit/scripts/`、测试或 `.mailhub/` 里的状态文件，去绕过检查、放行或确认环节。
- **不伪造结果。** 没有真实输出证明，就不说「好了」「完成了」。

## 2. 每次开场：先核对进度

先确认两件事：当前在项目根；`node -v` 能运行，并且版本不低于 22。任一项不满足，先按第 3 节处理，再回来。

```
node kit/scripts/setup.mjs status
```

输出里有：每一步 ✅ / ⬜ / ❌、上次卡在哪、下一步该跑什么、是否已完成。机器读取可加 `--json`。

- 显示「还没有开始」：从第 3 节做起。
- 已有配置：用一两句话告诉用户现在的进度（例如「上次做到开启收信路由，卡在需要你在 Cloudflare 网页上点一下」），然后从「下一步」继续。**不要重新问第 4 节已经答过的问题。**
- 显示「已完成」：告诉用户邮箱早已建好，问他这次想做什么（排障或调整，见第 9 节）。

## 3. 找到项目、补齐环境（对用户透明，不打扰）

1. 项目根不存在时：把用户给的压缩包解压，或把仓库克隆到项目根。
2. 运行 `node -v`。没有 Node，或主版本低于 22，就帮用户安装 Node.js 22 LTS：
   - macOS：从 https://nodejs.org 下载 LTS 版 .pkg 安装。或者有 Homebrew 时执行 `brew install node@22 && brew link --overwrite --force node@22`，这会替换用户原有的 node 链接，事后要告诉用户。
   - Windows：`winget install OpenJS.NodeJS.LTS`，装完新开一个终端。
   - Linux：先装 nvm：`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`，再执行 `nvm install 22`。
   - 安装需要管理员密码时，请用户在自己的终端里执行那一条命令。
3. `node kit/scripts/doctor.mjs`，退出码为 0 即可继续。如果 `cloudflare_api` 不通，请用户确认网络；需要代理时，在当前终端设置 `HTTPS_PROXY`。
4. `node kit/scripts/setup.mjs deps` 安装依赖，首次约 1–3 分钟。国内网络失败时重跑，并加 `--registry https://registry.npmmirror.com`。

## 4. 一次性问询

把下面这段**原样**发给用户（语气可以微调，不要删项），等用户一次答完：

> 我来帮你搭一套自己的域名邮箱，搭好、你亲自确认能用为止。做完后你会有：
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
> 5. 需要「数据接口」做二次开发吗？一般不需要。不需要的话，我就用默认地址 api-mail.你的域名（系统内部也要用它）；需要的话，告诉我你想用的地址。
> 6. 要保存邮件附件吗？需要在 Cloudflare 绑定信用卡或 PayPal 开通 R2（有 10GB 免费额度）。默认不保存，以后想开再说。
>
> 之后你只需要再做几件小事，到时我会提醒你：
> - 浏览器弹出 Cloudflare 授权页时，点「允许」；
> - 如果域名还没接入 Cloudflare，按我给的步骤改一次域名的 NS；
> - 在弹出的终端窗口里设置登录密码。
>
> 搭好后，请你亲自试三件事：登录网页、给 test@你的域名 发一封信、打开本地版。都没问题才算完成。

处理回答：

- 第 2 题答「有」：先说明后果，请用户选「换一个没在用的域名」或「确认放弃原邮箱」。选了放弃只算表明方向，不算同意。后面真遇到 MX 冲突时，要把检测到的收信服务器列给用户，再确认一次，然后才加 `--allow-existing-mx`。
- 第 3 题或第 5 题给的地址不是这个域名的子域名：请用户换一个。
- 拿到答案后执行下面两条。不要二次开发就不加 `--api-host`；要保存附件才加 `--attachments`。

```
node kit/scripts/setup.mjs init --domain <域名> --web-host <登录网页地址> --login-user <用户名> [--api-host <数据接口地址>] [--attachments]
node kit/scripts/setup.mjs plan
```

`plan` 输出的是即将创建的资源清单。简要告诉用户「我开始了」，直接进入第 5 节，不必等用户确认。

## 5. 执行搭建（逐步运行，每步都可安全重跑）

按顺序**一次运行一个步骤**：`node kit/scripts/setup.mjs <步骤>`。单步可能要跑几分钟，把命令超时设到你能设的最大值（至少 10 分钟）。

| 顺序 | 步骤 | 做什么 | 注意 |
|---|---|---|---|
| 1 | `login` | 登录 Cloudflare | 有图形界面时会打开浏览器，先告诉用户「请在弹出的页面点允许」。远程或无图形界面时返回 10，并给出链接和验证码，处理见下方 |
| 2 | `zone` | 确认域名已接入 Cloudflare | 见下方「退出码 10」 |
| 3 | `preflight` | 检查会不会覆盖用户已有的东西：别处的邮箱、兜底规则、两个网址、同名 Worker | 有冲突就停下，让用户决定 |
| 4 | `d1` | 建数据库、建表、登记域名 | |
| 5 | `r2` | 附件存储 | 没选附件时自动跳过 |
| 6 | `configs` | 生成部署配置和随机密钥 | 随机密钥自动生成，不用问用户 |
| 7 | `deploy-inbox` | 部署收信程序 | |
| 8 | `deploy-api` | 部署数据接口，并等它上线 | 新地址首次签发证书可能要几分钟 |
| 9 | `build` | 构建网页 | |
| 10 | `deploy-web` | 部署登录网页，并等它上线 | |
| 11 | `routing` | 开启收信路由，任意前缀的来信都交给收信程序 | |
| 12 | `local` | 启动本地版 | |
| 13 | `password` | 设置登录密码 | 见第 7 节 |
| 14 | `verify` | 全链路验收 | 见第 8 节 |

**每条命令结束后看退出码**，不要只看文字：

- `0`：成功，进入下一步。
- `10`：**需要用户本人操作。** 把输出里「🙋 请你操作」那段用大白话转告用户，等用户说好了，再重跑**同一步**。
  - `zone` 提示域名还没接入：用户在 Cloudflare 添加域名后，页面会给出两个 NS，用户要去买域名的平台把 NS 改成它们。改好后运行 `node kit/scripts/setup.mjs zone --wait 8`，它每 30 秒查一次，最多等 8 分钟。连续 2 轮仍未生效时，把当前状态和需要的 NS 再发给用户，请他核对改得对不对，然后按第 0 节暂停：NS 生效有时要几小时，请用户先去忙别的，回来说「继续搭建我的邮箱」即可。
  - `login` 返回了链接和验证码：把两者原样发给用户，请他在任意设备（手机也行）的浏览器里打开链接、输入验证码。用户说好了再重跑 `login`。
  - `preflight` / `routing` 报冲突：把提示转述给用户，按用户的回答处理：

    | 提示 | 用户回答 | 你做 |
    |---|---|---|
    | 域名有别的邮箱在收信 | 确认放弃原邮箱 | 重跑时加 `--allow-existing-mx` |
    | 已有兜底规则指向别处 | 确认接管 | 重跑时加 `--take-over-catch-all` |
    | 网址已有 DNS 记录，或已绑定别的 Worker（提示会一次列出所有被占用的地址） | 确认占用全部 | 重跑时加 `--take-over-host` |
    | 同上 | 只确认占用其中一个 | 重跑时加 `--take-over-host <那个地址>`，其余地址按「给了新地址」处理 |
    | 网址冲突 | 给了新地址 | 用新地址重新 `init`，从 `preflight` 起重跑 |
    | 已有同名 Worker | 「是我之前建的」 | 重跑时加 `--reuse-workers` |
    | 已有同名 Worker | 给了新前缀 | `init` 时加 `--prefix <新前缀>`，从 `preflight` 起重跑 |
    | 无法确认（查询失败） | — | 稍等后重跑，不加任何放行参数 |

    用户同意一次就会被记住，并绑定当时的域名、地址或前缀，之后重跑不用再加；换了域名或地址会重新提示。
- `1`：失败。读输出里的「失败」和「下一步」，修复后重跑同一步。同一步自动重试 2 次仍失败，就转入第 6 节，和用户核对现状。
- `2`：配置不合法。按提示修正，通常是重新 `init`，然后运行 `status`，从「下一步」继续。

常见失败：

| 现象 | 处理 |
|---|---|
| `deploy-api` / `deploy-web` 等上线超时 | 证书还在签发，过 2–3 分钟重跑同一步 |
| `routing` 报没能自动开启，或没能设置兜底规则 | 按输出提示，请用户在 Cloudflare 网页上操作一次，再重跑 |
| `npm ci` 失败或极慢 | `node kit/scripts/setup.mjs deps --registry https://registry.npmmirror.com` |
| 连不上 Cloudflare 接口 | 网络问题。国内需要代理时，请用户开代理，并在终端设置 `HTTPS_PROXY` 后重跑 |

## 6. 受阻时：和用户核对现状，直到走通

自动重试解决不了、或者需要用户参与时，按下面的循环推进，**不要停在「报错了」**：

1. **查现状**：运行 `node kit/scripts/setup.mjs status`；需要时再跑 `node kit/scripts/doctor.mjs` 或 `node kit/scripts/verify.mjs`，拿到真实输出。
2. **用大白话向用户报告**，四句话讲清：
   - 做到了哪一步；
   - 卡在哪、原因是什么；
   - 你打算怎么办；
   - 需要他做什么（不需要就明说「你不用做什么」）。
   
   技术细节放在后面，别让用户去猜术语。
3. **换路径推进**。常见的备选：
   - 按提示请用户在 Cloudflare 网页上手动点一次；
   - 换一个子域名或前缀；
   - 让用户开代理，或换一个网络；
   - 等 NS / 证书生效后再试。
   
   一条路走不通就换一条，但不碰第 1 节的红线。
4. **用户做完，或你改完之后**，重跑卡住的那一步，再 `status` 核对，回到第 5 节接着走。

反复卡在同一处时，把已经试过什么、各自的结果如实告诉用户，和他一起决定下一条路。不要隐瞒失败，也不要跳过这一步去做后面的步骤。

## 7. 设置登录密码（需要用户本人）

运行 `node kit/scripts/setup.mjs password` 之前，先告诉用户：「马上会弹出一个终端窗口，请在里面设置登录密码。输入时不显示，要输两次。」

- 这条命令会自动弹出终端窗口，最多等 8 分钟，用户设好就自动继续。
- 没弹出窗口时（比如远程机器、没有图形界面），输出里会给一条命令，请用户在**他自己的**终端里执行。
- 超时（退出码 10）：提醒用户后重跑同一步。
- 用户以后忘了密码、想改密码：让他自己运行 `node kit/scripts/set-login.mjs`。

## 8. 验收与交付

1. 运行 `node kit/scripts/setup.mjs verify`。退出码必须是 0，10 项全部 ✅。有 ❌ 时，按那一项的提示处理，或转入第 6 节，然后重跑。
2. 把输出末尾的「交付信息」整理好发给用户，并请他**亲自确认三件事**：
   - **登录**：打开云端登录网页，用自己的用户名和密码登录。
   - **收信**：用自己的 Gmail / QQ 等邮箱，发一封信到 `test@<域名>`；一分钟内，网页的收件箱里能看到。
   - **本地版**：运行 `./start.sh`（Windows 双击 `start.cmd`），浏览器能打开本地网页。
3. 用户说哪一件有问题，就按下表排查。修好后请他再试，直到三件都没问题：

   | 用户反馈 | 排查 |
   |---|---|
   | 登录不上 | 用户名不区分大小写，密码区分大小写。请用户运行 `node kit/scripts/set-login.mjs` 重设一次再试 |
   | 发了信，网页里看不到 | 先问发件邮箱有没有收到退信。再跑 `verify` 看收信路由与 MX 两项。然后在后台运行 `node kit/scripts/setup.mjs wrangler tail <前缀>-inbox --format pretty`（它会一直运行，看完就停掉），请用户再发一封，看收信程序有没有收到、有没有报错 |
   | 网页打不开 | 刚部署完时证书可能还没生效，等几分钟再试。国内网络请用户换个网络（比如手机流量）或开代理再试。本地版不受影响，可以先用 |
   | 发了信，网页里还是没有（续） | 请用户在 Cloudflare → 域名 → Email → Email Routing → Activity log 里，看这封信的处理结果。再查数据库最近收到的信：`node kit/scripts/setup.mjs wrangler d1 execute <前缀>-db --remote --yes -c .mailhub/generated/wrangler.api.json --command "SELECT mb.email, m.subject, m.received_at FROM messages m LEFT JOIN mailboxes mb ON mb.id = m.mailbox_id ORDER BY m.received_at DESC LIMIT 5"`。如果这个域名以前有别的邮箱，发件方可能还缓存着旧的 MX 记录（通常几分钟到几小时），请用户稍后再发一次 |
   | 本地版打不开 | `node kit/scripts/local.mjs status`。没在运行就执行 `./start.sh`，看输出里的原因 |

4. 三件事都确认后，运行 `node kit/scripts/setup.mjs confirm`。这条命令会做两件事：当场重跑 10 项验收；到数据接口里查有没有发给 `test@<域名>` 的信。两项都通过才记为完成。
   - 用户是发到了别的地址：加 `--mail <那个地址>`。
   - 返回 10（没查到信）：按第 3 步排查，不要跳过。

   `confirm` 成功后，告诉用户：
   - 邮箱已经建好，以下信息请保存：登录网页地址、用户名、本地版的启动和停止方法；
   - 日常使用不需要我：直接用网页，或本地的 `start.sh` / `stop.sh`；
   - 以后想调整或遇到问题，可以再叫我，我会先核对现状。

   到这里，搭建任务完成。

## 9. 用户的其它需求（调整与定制）

用户在搭建过程中或完成后提出别的要求（比如美化网页、换地址、开启附件），就照做。处理原则：

- **先复述**要改什么、会影响什么，涉及费用或原有数据时说清楚。
- **搭建中途提出纯界面类需求**：默认先把系统搭通，再改界面。这样出了问题容易分清是谁引起的。用户坚持要先改，就先改。
- **每次改完都要重新部署，并重跑 `verify`**，再请用户确认效果。改动涉及登录或收信时，第 8 节的三件事也要再确认一遍。

| 需求 | 怎么做 |
|---|---|
| 优化网页界面（样式、文案、布局） | **先问清楚**用户想要什么效果，必要时截图对照现状（例如现在的主色本来就是紫色）。代码在 `modules/unified-mail/frontend/src/`（React + Tailwind）：<br>· 颜色、字体等设计变量在 `styles/tokens.css`，其中渐变色是写死的色值，换主色时要一起改；<br>· 界面文字在 `i18n/messages.js`，中文、英文两套要同步改；<br>· 页面在 `pages/`。云端版只用到 `HubOverviewPage`、`UnifiedInboxPage`、`UnifiedCodePage`、`DomainMailPage`、`MessageDetailPage`、`CloudSettingsPage`、`LoginPage` 这几个；Hotmail 相关页面不会显示，不用改。<br>**本地预览**：先 `node kit/scripts/setup.mjs build`，再重启本地版（macOS / Linux：`./stop.sh && ./start.sh`；Windows：先双击 `stop.cmd`，再双击 `start.cmd`）。<br>**登录页只在云端出现**（本地版免登录，看不到登录页）：改登录页要先 `node kit/scripts/setup.mjs deploy-web`，再用浏览器的无痕窗口打开登录网址预览。<br>用户满意后发布到云端：`node kit/scripts/setup.mjs deploy-web` |
| 换登录网页或数据接口的地址 | `init` 只传要改的参数，比如 `init --web-host <新地址>`，没传的会沿用原值。然后运行 `status`，从「下一步」起依次跑到 `verify`，中途会重新做冲突检查。旧地址如果不再需要，请用户到 Cloudflare → Workers & Pages → 对应的 Worker → Settings → Domains & Routes 里移除 |
| 换登录用户名或密码 | 请用户自己运行 `node kit/scripts/set-login.mjs` |
| 开启附件保存 | 先说明需要绑卡，用户同意后运行 `init --attachments`，然后 `status`，从「下一步」起依次跑到 `verify`。关闭附件用 `init --no-attachments` |
| 再加一个域名 | 新域名要先在 Cloudflare 显示 Active。然后：① 登记域名：`node kit/scripts/setup.mjs wrangler d1 execute <前缀>-db --remote --yes -c .mailhub/generated/wrangler.api.json --command "INSERT INTO domains (id, domain, enabled, fixed_subdomain, random_subdomains, created_at) VALUES ('domain_<新域名>', '<新域名>', 1, NULL, '[]', datetime('now')) ON CONFLICT(domain) DO UPDATE SET enabled = 1"`；② 开启收信路由：`node kit/scripts/setup.mjs wrangler email routing enable <新域名>`；③ 请用户在 Cloudflare → 新域名 → Email → Email Routing → Routing rules 里，把 Catch-all 设为「Send to a Worker → <前缀>-inbox」；④ 请用户发一封测试信到新域名验证。开始前也要确认新域名没在用别的邮箱 |
| 其它功能需求 | 先说明实现思路和影响，用户同意后再做。改了登录网关（`modules/unified-mail/cloud/`）或安装脚本时，要跑 `cd kit && npm test` 和 `node --test modules/unified-mail/cloud/tests/*.test.mjs`，全部通过才能部署 |

用户自己做的这些改动只存在于他这份副本里。以后更新套件（`git pull`）时可能会冲突，建议用户用 git 提交自己的改动。

## 10. 关于这套系统（回答用户疑问时用）

- 在 Cloudflare 上有三个 Worker 和一个数据库，前缀默认是 `mailhub`：
  - `<前缀>-inbox`：收信；
  - `<前缀>-api`：数据接口；
  - `<前缀>-web`：登录网页；
  - D1 数据库 `<前缀>-db`：存信箱和邮件。
- 来信路径：外部邮件 → Cloudflare Email Routing 的兜底规则 → `<前缀>-inbox` 解析后存进 D1 → 网页通过 `<前缀>-api` 读取。
- 本地版就是同一个登录网页在本机运行。它只允许本机访问、免登录，数据和云端是同一份。它只接受本机页面自己发起的修改请求，别的网站想借用户的浏览器偷偷操作会被拒绝（403）。
- 用户要做二次开发时，接口说明在 `kit/docs/data-api.md`。
- 费用：
  - 收信、Worker、D1 都在 Cloudflare 免费额度内；
  - R2 附件存储有 10GB 免费额度，但开通要绑卡；
  - 对外发信需要 Workers 付费版（5 美元/月），本套件默认不开。
- 更新套件：在项目根执行 `git pull`，把 `kit/skill/mailhub-setup/` 重新复制到你的 skills 目录，再从 `deps` 起把各步重跑一遍。已完成的步骤会被跳过或原样覆盖。
