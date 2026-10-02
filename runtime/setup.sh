#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
task_runtime="$task_root/.runtime"
task_source="$task_runtime/nanobot"
task_commit="d0d0a44e57632c3d269e511339cff7ddb698e62e"
command -v uv >/dev/null || { echo 'Install uv first: https://docs.astral.sh/uv/'; exit 1; }
command -v git >/dev/null || { echo 'Git is required.'; exit 1; }
mkdir -p "$task_runtime"
chmod 700 "$task_runtime"
if [ ! -d "$task_source/.git" ]; then
  mkdir -p "$task_source"
  git -C "$task_source" init
  git -C "$task_source" remote add origin https://github.com/HKUDS/nanobot.git
elif [ "$(git -C "$task_source" remote get-url origin)" != 'https://github.com/HKUDS/nanobot.git' ]; then
  echo 'The runtime origin is not the expected HKUDS/nanobot repository.'
  exit 1
elif [ -n "$(git -C "$task_source" status --porcelain)" ]; then
  echo 'The runtime source has local edits. Save them before running setup.'
  exit 1
fi
git -C "$task_source" fetch --depth 1 origin "$task_commit"
git -C "$task_source" checkout --detach "$task_commit"
if [ ! -x "$task_runtime/.venv/bin/python" ]; then
  uv venv --python 3.11 "$task_runtime/.venv"
fi
uv pip install --python "$task_runtime/.venv/bin/python" --editable "$task_source"
"$task_runtime/.venv/bin/python" "$task_root/runtime/bridge.py" --status
