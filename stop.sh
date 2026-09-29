#!/usr/bin/env sh
# 停止本地版 MailHub，并复核进程与端口已释放。
cd "$(dirname "$0")" && exec node kit/scripts/local.mjs stop
