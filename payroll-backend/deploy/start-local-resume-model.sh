#!/bin/bash
set -Eeuo pipefail
umask 077

# This helper starts only an already downloaded model. No downloads or remote calls.
LMS_BIN="${LMS_BIN:-$HOME/.lmstudio/bin/lms}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
[ -x "$LMS_BIN" ] || { echo "未找到 LM Studio CLI，请打开 LM Studio 检查安装。" >&2; exit 1; }
"$LMS_BIN" server start --bind 127.0.0.1 --port 1234
if "$NODE_BIN" --input-type=module -e '
  const r = await fetch("http://127.0.0.1:1234/v1/models", {signal: AbortSignal.timeout(5000)});
  const data = await r.json();
  process.exit(r.ok && data.data?.some(m => m.id === "hr-resume-qwen3-vl-8b") ? 0 : 1);
'; then
  echo "HR 简历模型已就绪。"
else
  "$LMS_BIN" load qwen/qwen3-vl-8b --identifier hr-resume-qwen3-vl-8b --context-length 16384 --parallel 1 -y
fi
