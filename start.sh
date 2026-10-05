#!/usr/bin/env sh
# 启动本地版 MailHub（已在运行则直接复用），并打开浏览器。用搭建时记录的 Node，见 kit/scripts/node.sh。
cd "$(dirname "$0")" && exec sh kit/scripts/node.sh kit/scripts/local.mjs start --open
