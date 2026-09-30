<!-- purpose: mailhub-setup 的参考文件：Windows 与多套 Node 的运行时处理、Cloudflare 授权无弹窗 / verifier 已使用的恢复、密码窗口不可见。 -->

# Windows、Node 与 Cloudflare 授权恢复

## 确认真实执行环境

用 `process.platform`、PowerShell / shell 环境和可执行文件路径判断平台。Windows 项目根是 `$env:USERPROFILE\mailhub-kit`；不要在当前聊天的空目录重新部署一套。

```powershell
Get-Command node -ErrorAction SilentlyContinue
node -p "JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,exe:process.execPath})"
```

缺 Node 时可安装官方 LTS；不需要替换用户全局 Node。便携版放 `.mailhub/runtime/`（Git 忽略）并核验 nodejs.org 发布的 SHASUMS256.txt。选择匹配系统架构的官方包，不从不明镜像下载运行时。

Windows 上部分 Node 版本可能在命令显示通过后仍以 libuv assertion 非零退出。遇到此类兼容性故障时保留日志，使用 Node 22 LTS 或 24 LTS 复测，不忽略退出码，也不为了通过而改测试。用变量保存实际路径：

```powershell
$mailhubNode = 'C:\实际路径\node.exe'
& $mailhubNode -v
& $mailhubNode kit/scripts/setup.mjs status
& $mailhubNode kit/scripts/setup.mjs configs
```

configs 将路径记录在 `.mailhub/runtime.json`。`start.cmd`、`stop.cmd` 和 `mailhub.cmd` 随后都使用它，即使全局 PATH 指向其它 Node。记录的 Node 被移动/删除时会明确失败，先用新的可用路径重跑 configs。开发测试推荐最新 Node 22 LTS / 24 LTS（安全回归使用内置 node:sqlite）。

PowerShell 路径用 `& '带空格的路径\node.exe' 参数`；npm 用 `npm.cmd` 或当前运行时配套的 npm-cli.js。启动后台辅助进程时隐藏窗口；只有用户需要交互输入密码的终端才显示。执行删除/移动前验证绝对路径属于本任务，不能跨 shell 拼接删除命令。

## 没有授权弹窗

工具可以启动浏览器命令，不代表用户真的看见浏览器。桌面 agent 或远程环境没有弹窗时：

1. 直接用 `setup.mjs login --device`。它先检查现有凭据，有效就直接继续，不重新授权。
2. 尚未授权时同一命令会进入设备码流程；普通 `login` 会尝试打开浏览器，此场景不要用它做只读检查。
3. 给用户当前命令输出的登录入口和设备码，或在可用浏览器打开入口；让用户本人选择账号并允许。不要自动点授权同意。
4. 用户完成后重跑 `login --device`，以 whoami 的权限和账号结果为准。

## consent verifier has already been used

这是一次性回调已被消费的提示，不能单凭该页面判定整个登录失败。

1. 不刷新、重开或复制那条很长的 consent/verify 回调 URL；它可能包含一次性敏感材料，不放进公共日志。
2. 重跑 `setup.mjs login --device`。退出 0 说明 CLI 已登录，直接继续下一步。
3. 如果仍未登录，运行 `login --device` 获取新的入口和设备码。只使用当前 CLI 返回的入口，避免重复使用已消费的页面。
4. 设备流程还在运行时脚本会复用该流程；如已经被拒绝/过期，等该登录进程退出后再重跑以生成新码。不要同时启动多个轮询进程，不删除其它工具的 Cloudflare 登录配置。
5. 重复失败时核实账号、系统时间、网络/代理以及输出中的错误；需要重新授权缺少的权限时遵循 CLI 提示。不要用 logout 作为已成功授权后的默认恢复动作。

单独的 `access_denied` 不等于 verifier 已使用，还可能是用户拒绝授权或账号权限策略。先读具体 error_description，核对 CLI 登录状态；用户明确拒绝时先了解其意图，不自动反复发起授权。

## 密码窗口不可见

`setup.mjs password` 会同时输出手动命令，使用当前 Node 的绝对路径。用户在自己的 PowerShell 执行，不通过聊天传密码。明确告知“已请求打开窗口”，而非声称“窗口已经弹出”。如环境不能打开窗口，使用 `password --no-terminal` 并显示脚本提供的命令。
