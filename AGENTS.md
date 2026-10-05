<!-- purpose: 给 AI 助手（Codex / Claude Code / Hermes 等）的入口：安装项目、注册 MailHub skill、完成域名邮箱部署。 -->

# MailHub Kit · AI 助手入口

用户把这个项目交给你，是要你**替他把自己的域名邮箱完整搭建成功**。这是一次性任务：机器验收通过、并由用户亲自确认邮箱能用，才算结束。没建成之前，你要一直和用户核对现状、往下推进。

按下面三步走。先不要问用户问题，问询在 skill 的第 4 节统一进行。

**运行位置**：这套流程要在用户本人能操作的电脑上跑（他自己的电脑，或他能 SSH 登录的机器）。中途要他在浏览器里点授权、在终端里输入登录密码，本地版也只对那台机器开放。如果你运行在用户碰不到的云端容器里，走不完这个流程，请用户改在自己电脑上的 AI 工具里执行。

**权限**：你的命令要能联网、能写用户主目录（`~/mailhub-kit`、第 2 步的 skills 目录、wrangler 的登录信息），还要能让本地版在后台常驻。你所在的工具如果有沙箱（例如 Codex 默认不联网、不能写工作区以外的目录），先向用户申请这些权限，或请他切到允许联网的模式。之后网络检查不通时，先排除是沙箱拦的，再去怀疑用户的网络。

项目地址：https://github.com/xtianowner/mailhub-kit。如果你是通过网址读到本文件、本机还没有这个项目，就按第 1 步先把它下载下来。

## 1. 放到固定位置

项目根必须是：

- macOS / Linux：`~/mailhub-kit`
- Windows：用户主目录下的 `mailhub-kit`。PowerShell 写 `"$env:USERPROFILE\mailhub-kit"`，cmd 写 `%USERPROFILE%\mailhub-kit`，Git Bash 写 `~/mailhub-kit`。不要把 `%USERPROFILE%` 原样写进 PowerShell 或 Git Bash 的命令：它不会被展开，会在当前目录建出一个字面上叫 `%USERPROFILE%` 的文件夹，下次就找不到进度了。

- 这个目录**已经存在**时，不要覆盖：它可能是一次没做完的搭建，进度就记在里面。直接在那里继续，第 3 步的 `status` 会告诉你做到了哪。
- 不存在时：
  - 有 git：`git clone https://github.com/xtianowner/mailhub-kit.git ~/mailhub-kit`。Windows 上目标路径按上面对应 shell 的写法。
  - 没有 git：下载 https://github.com/xtianowner/mailhub-kit/archive/refs/heads/main.zip，解压后把文件夹 `mailhub-kit-main` 改名为 `mailhub-kit`，放到上面的位置。
  - 克隆和下载都失败（国内网络常见）：请用户在自己的浏览器里下载上面的 zip，把文件路径告诉你，再按下一条处理。
  - 用户直接给了压缩包或文件夹：解压或复制过去。

之后所有命令都在这个目录里执行。检查方法：项目根下存在 `kit/scripts/setup.mjs` 这个文件。

## 2. 注册为 skill

搭建可能跨好几次对话，比如等域名生效要几小时。注册成 skill 后，用户关掉工具再回来，说一句「继续搭建我的邮箱」，你就能从上次停下的地方接着做。

把 `kit/skill/mailhub-setup/` 整个目录复制到你所在工具的 skills 目录，目标目录名保持 `mailhub-setup`：

| 你是 | 复制到 |
|---|---|
| Claude Code | `~/.claude/skills/mailhub-setup/` |
| Codex | `~/.agents/skills/mailhub-setup/` |
| Hermes Agent | `~/.hermes/skills/mailhub-setup/` |
| 其它支持 Agent Skills（SKILL.md）的工具 | `~/.agents/skills/mailhub-setup/` |

Windows 上把 `~` 换成用户主目录（PowerShell 写 `$env:USERPROFILE`）。

支持 Agent Skills 的工具通常不用重启就能发现这个 skill。邮箱建好、用户确认之后，这个 skill 的任务就结束了，日常使用不需要它；用户愿意的话可以删掉。

## 3. 开始执行

读取 `kit/skill/mailhub-setup/SKILL.md`，从第 0 节开始严格照做。

先确认真实的操作系统，以及 `node -v` 能运行、版本不低于 22（推荐 22 或 24 LTS）；不满足就按 SKILL 第 3 节先装好，不必替换用户已有的全局 Node。然后运行 `node kit/scripts/setup.mjs status`（Windows 跑过 `configs` 后也可用 `.\mailhub.cmd status`），确认是全新开始，还是接着上次继续。

几处容易误判的地方（细节见 SKILL）：新部署默认只收登记过的地址，验收前用 `prepare-test` 登记测试地址，邮箱列表为空不代表部署失败；Cloudflare 授权没有弹窗、或页面提示 verifier 已使用时，用 `login --device` 核实；重复运行会沿用已有配置和授权，并保留用户自己的改动。
