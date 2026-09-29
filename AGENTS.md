<!-- purpose: 给 AI 助手（Codex / Claude Code / Hermes 等）的入口：把本项目放到固定位置、注册一次性搭建 skill、开始或继续搭建。 -->

# MailHub Kit · AI 助手入口

用户把这个项目交给你，是要你**替他把自己的域名邮箱完整搭建成功**。这是一次性任务：以用户亲自确认邮箱能用为结束。没建成之前，你要一直和用户核对现状、往下推进。

按下面三步走。先不要问用户问题，问询在 skill 的第 4 节统一进行。

项目地址：https://github.com/xtianowner/mailhub-kit。如果你是通过网址读到本文件、本机还没有这个项目，就按第 1 步先把它下载下来。

## 1. 放到固定位置

项目根必须是：

- macOS / Linux：`~/mailhub-kit`
- Windows：`%USERPROFILE%\mailhub-kit`

- 这个目录**已经存在**时，不要覆盖：它可能是一次没做完的搭建，进度就记在里面。直接在那里继续，第 3 步的 `status` 会告诉你做到了哪。
- 不存在时：
  - 有 git：`git clone https://github.com/xtianowner/mailhub-kit.git ~/mailhub-kit`。Windows 上目标路径换成 `%USERPROFILE%\mailhub-kit`。
  - 没有 git：下载 https://github.com/xtianowner/mailhub-kit/archive/refs/heads/main.zip，解压后把文件夹 `mailhub-kit-main` 改名为 `mailhub-kit`，放到上面的位置。
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

本次不需要重启工具。邮箱建好、用户确认之后，这个 skill 的任务就结束了；用户愿意的话可以删掉它，日常使用不需要它。

## 3. 开始执行

读取 `kit/skill/mailhub-setup/SKILL.md`，从第 0 节开始严格照做。

先确认 `node -v` 能运行、版本不低于 22；不满足就按 SKILL 第 3 节先装好。然后运行 `node kit/scripts/setup.mjs status`，确认是全新开始，还是接着上次继续。
