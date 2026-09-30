<!-- purpose: 收信模式（登记 / 自动）与登录限速的行为、边界和升级部署顺序，给用户和维护者读。 -->

# 收信模式与登录保护

「设置 → 收信模式」对云端网页和本地版共同生效。保存后用于之后到达的邮件，不删除历史信件。

- **登记后收信（默认）**：先在「域名邮箱」创建地址，只有已登记、启用的邮箱及域名可收信。未知地址在读取邮件正文、建立邮箱或保存邮件前被拒收。自动模式创建的地址需要在邮箱列表点「登记」后继续收信，已有邮件会保留。
- **自动模式**：任意前缀的来信都会自动建立邮箱，恢复原有 Catch-all 行为。此模式更方便，但也接受发往随机地址的垃圾邮件。

新部署默认是登记模式。从「任意前缀自动收信」的旧版本升级时，数据库里已有信箱或邮件的，迁移后保持自动模式，收信行为不变，需要时再到设置里切换。

被拒收的邮件不会在之后登记地址时恢复。登记模式限制可收信的地址，不能阻止垃圾邮件发往已知的已登记地址，也不能完全消除入口请求消耗。

云端登录限制为每个 IP 每 5 分钟最多 5 次尝试，以及所有来源每分钟合计最多 30 次尝试（包括成功登录）。达到限制返回 HTTP 429 和 Retry-After；计数器不可用时暂停新登录，已有有效会话不受影响。计数保存在 D1，跨 Worker 实例生效；数据库不保存原始 IP。

## 部署流程

1. 应用 `modules/cfmail-worker/migrations/0003_mail_security.sql`（通过 D1 migrations apply）。迁移保留邮件与邮箱记录，模式配置由数据库保存。**必须先于部署新版收信 Worker**：新版收信 Worker 读不到收信设置时会拒收（Cloudflare 重试后给发件方退信），不会退回到自动收信。
2. 运行 `setup.mjs configs`，为网页网关增加共享 D1 绑定。
3. 部署 API 和收信 Worker，构建网页并部署网页 Worker。
4. 重启本地版；检查设置显示的实际模式；运行 `setup.mjs prepare-test` 登记测试地址，再由用户发送外部测试邮件。
5. 运行 `setup.mjs verify`，并由用户验证登录、外部收信、本地访问。

修改设置要求管理员认证；云端与本地网关均保留跨站修改防护。不要通过前端隐藏按钮代替服务端鉴权。

推荐逐步执行（Windows 可把 `node kit/scripts/setup.mjs` 换为 `./mailhub.cmd`）：

```text
node kit/scripts/setup.mjs d1
node kit/scripts/setup.mjs configs
node kit/scripts/setup.mjs deploy-api
node kit/scripts/setup.mjs deploy-inbox
node kit/scripts/setup.mjs build
node kit/scripts/setup.mjs deploy-web
node kit/scripts/local.mjs stop
node kit/scripts/local.mjs start
node kit/scripts/setup.mjs prepare-test
node kit/scripts/setup.mjs verify
```

默认模式为 `registered`，需要接收邮件的地址应先登记。D1 迁移为增量操作，不删除邮件或邮箱记录。机器检查不能替代真实外部收信、密码登录和用户确认。
