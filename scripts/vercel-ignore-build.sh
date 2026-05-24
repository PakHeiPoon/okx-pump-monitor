#!/usr/bin/env bash
# Vercel "Ignored Build Step" hook.
#
# Project Settings → Git → Ignored Build Step → Custom command:
#   bash scripts/vercel-ignore-build.sh
#
# Exit 0 → skip deploy（不消耗 deploy 配额）
# Exit 1 → proceed deploy（dashboard / scanner 代码真改变了）
#
# 底层逻辑：scan.yml / scan-realtime.yml 每 15min/5min 会自动 commit
# state.json / state-realtime.json 回 main 分支。这些纯运行时状态文件
# 跟 dashboard build artifact 完全无关，必须排除。
#
# 没有这一行 fix → 每天 100+ 自动 deploy 烧光 Hobby quota，user push 自己
# 的 feature 时反而被 402 拦截。

set -u

# Files that are POSITIVELY safe to ignore（cron 唯一会动的）
SAFE_IGNORE=(
  "state.json"
  "state-realtime.json"
)

# 构造 git diff exclude pattern：':!path'
EXCLUDES=()
for f in "${SAFE_IGNORE[@]}"; do
  EXCLUDES+=(":!${f}")
done

# git diff --quiet：
#   exit 0 = 无差异（即只有 EXCLUDES 列表里的文件改变）→ 我们 skip
#   exit 1 = 有差异（dashboard/scanner/yml 实际改了）→ 我们 deploy
# 注意：Vercel 给的 HEAD^..HEAD 是 single-commit diff，对 squash-merge 也准
git diff --quiet HEAD^ HEAD -- . "${EXCLUDES[@]}"
RC=$?

if [ $RC -eq 0 ]; then
  echo "▶ vercel-ignore-build: only [${SAFE_IGNORE[*]}] changed → SKIP deploy"
  exit 0
fi

echo "▶ vercel-ignore-build: meaningful code changes → PROCEED deploy"
exit 1
