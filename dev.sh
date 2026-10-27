#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python || ! -d web/node_modules ]]; then
  echo '먼저 README의 Python·npm 의존성 설치를 실행하세요.'
  exit 1
fi
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
api_pid=$!
cleanup() { kill "$api_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
npm run dev --prefix web
