#!/usr/bin/env sh
# 停止本地版 MailHub，并复核进程与端口已释放。用搭建时记录的 Node，见 kit/scripts/node.sh。
cd "$(dirname "$0")" && exec sh kit/scripts/node.sh kit/scripts/local.mjs stop
