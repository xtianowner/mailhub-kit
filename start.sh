#!/usr/bin/env sh
# 启动本地版 MailHub（已在运行则直接复用），并打开浏览器。
cd "$(dirname "$0")" && exec node kit/scripts/local.mjs start --open
