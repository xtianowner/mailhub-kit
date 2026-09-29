<!-- purpose: 数据接口（<前缀>-api Worker）的对外说明，给要做二次开发的用户。以 modules/cfmail-worker/src/mail-api.js 为准。 -->

# 数据接口（二次开发用）

地址：安装时的 `api_host`，默认 `https://api-mail.你的域名`。

## 鉴权：两把密钥，按路径区分

| 路径 | 怎么带密钥 | 密钥在哪 |
|---|---|---|
| `/admin/*` | 请求头 `x-admin-auth: <CFMAIL_ADMIN_TOKEN>` | 本机 `.mailhub/generated/.dev.vars` |
| `/api/*` | 查询参数 `?password=<CFMAIL_SITE_PASSWORD>` | 同上 |

两把密钥不能混用，用错会返回 401。密钥等同于完整的邮箱读写权限，只在服务端使用，不要放进网页或 App。

## 接口

| 方法 | 路径 | 参数 | 返回 / 用途 |
|---|---|---|---|
| GET | `/` | — | `{ok, domains}`，健康检查（免鉴权） |
| GET | `/admin/domains` | — | 已启用收信的根域列表 |
| GET | `/admin/mailboxes` | `q` `limit` `offset` | 全部信箱（含来信时自动创建的） |
| POST | `/admin/new_address` | JSON `{name, domain}` | 新建信箱；不给 `name` 就随机生成 |
| POST | `/admin/mailboxes/meta` | JSON `{email, label, group}` | 修改信箱的备注和分组 |
| GET | `/admin/messages/recent` | `q` `limit` `offset` `only_codes=1` | 跨所有信箱、按时间倒序的邮件列表（不含完整正文） |
| GET | `/admin/mails` | `address` `limit` `offset` | 某个信箱的邮件 |
| GET | `/admin/message` | `id` | 单封邮件全文（文本、HTML、附件信息） |
| GET | `/api/mailboxes/code` | `email` `password` | 该信箱最新一封邮件里的验证码和链接 |
| GET | `/api/messages/latest` | `password` | 全局最新一封邮件 |
| GET | `/admin/sending/status` | — | 发信能力状态（默认未开通） |
| POST | `/admin/send` | JSON `{from_address, to, subject, text}` | 发信。需要 Workers 付费版并开通发信，本套件默认不开 |

## 例子：取某个地址的最新验证码

```bash
curl "https://api-mail.example.com/api/mailboxes/code?email=signup@example.com&password=$CFMAIL_SITE_PASSWORD"
```
