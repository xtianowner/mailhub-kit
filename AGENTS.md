<!-- purpose: 给 AI 助手（Codex / Claude Code / Hermes 等）的入口：把本项目放到固定位置、注册 skill、开始搭建。 -->

# MailHub Kit · AI 助手入口

用户把这个项目交给你，是想让你**替他从零搭好自己的域名邮箱**。按下面三步走，不需要先问用户任何问题（问询在 skill 的第 2 节统一进行）。

## 1. 放到固定位置

项目根必须是：

- macOS / Linux：`~/mailhub-kit`
- Windows：`%USERPROFILE%\mailhub-kit`

如果当前不在这里，就把整个项目复制、解压或克隆过去。之后所有命令都在这个目录里执行。
检查方法：项目根下存在 `kit/scripts/setup.mjs` 这个文件。

## 2. 注册为 skill

把 `kit/skill/mailhub-setup/` 整个目录复制到你所在工具的 skills 目录，目标目录名保持 `mailhub-setup`：

| 你是 | 复制到 |
|---|---|
| Claude Code | `~/.claude/skills/mailhub-setup/` |
| Codex | `~/.agents/skills/mailhub-setup/` |
| Hermes Agent | `~/.hermes/skills/mailhub-setup/` |
| 其它支持 Agent Skills（SKILL.md）的工具 | `~/.agents/skills/mailhub-setup/` |

复制完成后，告诉用户一句：「已注册 mailhub-setup，以后说『启动我的邮箱』『改邮箱密码』我都知道怎么做。」
本次不需要重启工具，直接进入第 3 步。

## 3. 开始执行

读取 `kit/skill/mailhub-setup/SKILL.md`，从第 0 节开始严格照做。
