#!/usr/bin/env bash
# Starts the backend, waits until it answers, then runs the frontend dev server (Linux and macOS).
# Ctrl+C stops both. Backend output goes to logs/backend.log.
#
#   ./start.sh
#
# Set ANTHROPIC_API_KEY first, or OPENAI_API_KEY with app.ai.provider: openai (and optionally AZURE_SPEECH_KEY /
# AZURE_SPEECH_REGION for voice).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_URL="http://localhost:8080/api/companies"
WAIT_SECONDS=180
LOG="$ROOT/logs/backend.log"

for cmd in java mvn npm curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is not installed or not on PATH." >&2
    exit 1
  fi
done
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "Warning: neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set; the backend will not start without the selected provider's key." >&2
fi
if curl -s -o /dev/null "$BACKEND_URL"; then
  echo "Error: something is already running on port 8080. Stop it first." >&2
  exit 1
fi

mkdir -p "$ROOT/logs"
backend_pid=""
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$backend_pid" ] && kill -0 "$backend_pid" 2>/dev/null; then
    echo
    echo "Stopping backend..."
    # The backend runs in its own process group (set -m), so this also stops the JVM Maven forks.
    kill -TERM -- "-$backend_pid" 2>/dev/null || kill -TERM "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting backend (log: logs/backend.log)..."
set -m
(cd "$ROOT/backend" && exec mvn -q spring-boot:run) >"$LOG" 2>&1 &
backend_pid=$!
set +m

printf "Waiting for backend on http://localhost:8080 "
for ((i = 0; i < WAIT_SECONDS; i++)); do
  if curl -s -o /dev/null "$BACKEND_URL"; then
    echo " ready."
    break
  fi
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    echo
    echo "Error: the backend stopped while starting. Last lines of logs/backend.log:" >&2
    tail -n 30 "$LOG" >&2
    exit 1
  fi
  printf "."
  sleep 1
done
if ! curl -s -o /dev/null "$BACKEND_URL"; then
  echo
  echo "Error: the backend did not start within ${WAIT_SECONDS}s. See logs/backend.log." >&2
  exit 1
fi

cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install
fi
echo "Starting frontend; open the Local URL Vite prints below (normally http://localhost:5173). Ctrl+C stops both."
npm run dev
