<!-- purpose: kit/ 安装器的开发者说明：目录结构、脚本约定、测试怎么跑。使用说明见仓库根 README 与 skill。 -->

# kit/ · MailHub 安装器

把「Cloudflare 账号 + 一个域名 + 这台电脑」变成一套可用的域名邮箱。给 AI 执行的完整流程在 [`skill/mailhub-setup/SKILL.md`](skill/mailhub-setup/SKILL.md)，本文只讲实现。

## 目录

| 路径 | 作用 |
|---|---|
| `skill/mailhub-setup/SKILL.md` | agent 技能（Agent Skills 标准格式）：问询模板、步骤表、退出码处理、红线 |
| `scripts/setup.mjs` | 总控：`init` / `plan` / `all` / 单步；`status` 现状与下一步；`confirm` 用户确认后记为完成；`wrangler …` 透传给自带的 wrangler 并带上账号 |
| `scripts/local.mjs` | 本地版 `start` / `stop` / `status`；停止后复核进程与端口已释放 |
| `scripts/set-login.mjs` | 用户本人在终端里设置登录名和密码（不回显、输两次） |
| `scripts/verify.mjs` | 线上 + 本地验收（含收信模式与未授权拒绝），并打印交付信息 |
| `scripts/doctor.mjs` | 只读环境自检 |
| `scripts/node.sh` / `scripts/node.ps1` | 启动器：用 `configs` 记录在 `.mailhub/runtime.json` 的 Node 运行脚本（`start.sh` / `stop.sh` 用前者，`*.cmd` 用后者），不受用户 PATH 里旧版 Node 影响 |
| `scripts/lib/` | `common` 路径、子进程、退出码；`config` 配置校验与 wrangler 配置生成；`cf` Cloudflare 只读查询；`build` 依赖与前端构建 |
| `schema/0000_base.sql` | D1 基础表（增量迁移在 `modules/cfmail-worker/migrations/`） |
| `docs/data-api.md` | 数据接口说明（二次开发用） |
| `tests/` | 单元测试、离线编排测试、离线全链路测试 |

## 约定

- **只用 Node 内置模块 + 锁定版本的 wrangler**（`package.json` 里写死版本号），macOS / Linux / Windows 共用一份代码。wrangler 通过 `process.execPath` 直接调用，不经过 shell，也不经过 npx。
- **改动类操作一律走 wrangler 命令**；只有 wrangler 不给 JSON 的只读查询（zone 状态、Email Routing 状态）才直接调 Cloudflare REST，令牌来自 `wrangler auth token`。
- **密钥不进命令参数**：部署时写进临时文件（POSIX 权限 600，Windows 权限由 ACL 决定）、随版本上传后立即删除（`--secrets-file`）；`secret put` 走 stdin；子进程输出里的密钥值会被抹掉。
- **每一步都可重跑**：已有的资源复用；`SESSION_SECRET` 已存在就不换（换了会让所有设备掉线）；本机接口密钥复用，不轮换。
- **不静默改用户已有的东西**：出现以下情况时，退出码 10 停下，由用户决定：
  - 域名正在别处收信；
  - 兜底规则指向别处；
  - 网址已有 DNS 记录，或已绑定别的 Worker；
  - 账号里已有同名 Worker。

  用户同意后才加对应的放行参数（`--allow-existing-mx` / `--take-over-catch-all` / `--take-over-host` / `--reuse-workers`）。同意会记进 `state.json`，并绑定当时的域名、地址或前缀。DNS 等查询失败时一律停下，不当成「没有」。
- **wrangler 做不到或做不对的操作走 REST**：设置「兜底规则 → Worker」（4.142 的命令只接受 forward / drop）、查自定义域名占用、查同名 Worker。
- **完成标准 = 机器验收全绿 + 用户本人确认**：
  - 每步的结果都记进 `state.json`：成功记完成时间；失败记在 `last_error`，并撤销这一步旧的完成记录。
  - `status` 据此告诉 agent 现在到哪、卡在哪、下一步跑什么。
  - `confirm` 不看旧记录，当场重跑全部验收，并到数据接口里查有没有发给 `test@域名` 的信（地址可用 `--mail` 指定），两项都过才记为完成。
- **重新 `init` 是合并式**：只改传入的参数，其余沿用原值（`--no-attachments` 关闭附件）。配置一变，旧的完成记录和用户确认都作废；各步可重跑，已有资源会复用。「这些 Worker 是本套件建的」这条记录绑定前缀，换了前缀要重新检查同名 Worker。
- **放行只对用户看到的那条生效**：地址冲突会一次列全；`--take-over-host <地址>` 只放行这一个地址。
- 本机状态全部在仓库根的 `.mailhub/`（已被 git 忽略）：`config.json` 问询结果、`state.json` 进度、`generated/` 生成的 wrangler 配置和 `.dev.vars`（POSIX 权限 600；Windows 由 ACL 控制）。

## 测试

```bash
cd kit && npm ci && npm test      # 单元测试 + 离线编排测试（用假 wrangler 和本地假服务扮演 Cloudflare）
                                  # 编排测试末尾是契约测试：把实际调用过的 wrangler 命令交给真 wrangler 重放参数校验
cd ..
node kit/scripts/setup.mjs build  # 全链路测试需要静态资源
node kit/tests/e2e-local.mjs
# 离线全链路：用 wrangler 本地模拟器跑真实 Worker 代码与 SQL，
# 覆盖建表、未登记拒收、登记收信、自动建箱、模式切换、邮件保留、验证码与本地网关
node --test modules/cfmail-worker/tests/*.test.mjs modules/unified-mail/cloud/tests/*.test.mjs   # 登录网关的鉴权边界（含本地免登录）
```

`MAILHUB_STATE_DIR`、`MAILHUB_WRANGLER_JS`、`MAILHUB_TEST_*` 这几个环境变量只给测试用，正常使用不要设置。

## Agent 与运行时能力

- `prepare-test [--mail <地址>]`：在已启用域名登记测试收件人，保留 ID 与已有邮件，手动登记地址不重复写入，停用地址返回 10。不会发送邮件或记录用户确认。
- `configs` 记录当前 Node 到 `.mailhub/runtime.json`；Windows 的 `mailhub.cmd`、`start.cmd`、`stop.cmd` 共用 `scripts/node.ps1`，保留参数与退出码。移动运行时后用新 Node 重跑 configs。
- `all` 按顺序执行各步并复用资源；使用 `status`、单步命令或 `all --from` 接续。
- 授权页异常先检查 CLI 登录，密码窗口无法显示时提供实际 Node 路径的手动命令。详见 skill 的平台参考文件。
- 开发回归使用 Node 22 / 24 LTS（内置 node:sqlite）；Windows/Linux CI 测试安装器、收信安全、网关和 Wrangler 本地收信。
