#!/usr/bin/env sh
# macOS / Linux 版的 node.ps1：用 setup configs 记录的 Node（含便携版、nvm 装的版本）运行脚本，
# 即使 PATH 里是别的 Node。没有记录时才用 PATH 里的 node。参数原样转发，退出码原样返回。
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd) || exit 1
STATE=${MAILHUB_STATE_DIR:-$ROOT/.mailhub}
RUNTIME=$STATE/runtime.json

if [ -f "$RUNTIME" ]; then
  NODE=$(sed -n 's/.*"execPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RUNTIME" | head -n 1)
  if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
    echo "Saved Node runtime is missing. Run setup.mjs configs using your working Node installation." >&2
    exit 1
  fi
else
  NODE=$(command -v node) || { echo "node not found. Install Node 22+ or run setup.mjs configs." >&2; exit 1; }
fi

cd "$ROOT" || exit 1
exec "$NODE" "$@"
