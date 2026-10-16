#!/usr/bin/env bash
# Start an ngrok tunnel to the runner's callback server and use it as MYOB's redirect_uri.
# Extra args are passed to runner/index.js (e.g. --no-open).
#
# MYOB only redirects to URIs registered in the developer dashboard, so set NGROK_DOMAIN in .env
# to your static ngrok domain and register https://<that domain> as a redirect URI.
set -euo pipefail
cd "$(dirname "$0")/.."

# Read just the values this script needs; .env isn't valid bash (e.g. MYOB_SCOPES has spaces), so
# Node loads the rest via --env-file below. Real environment variables win over .env.
env_value() {
  [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g'
}
NGROK_DOMAIN="${NGROK_DOMAIN:-$(env_value NGROK_DOMAIN || true)}"
PORT="${PORT:-$(env_value PORT || true)}"

PORT="${PORT:-8080}"
LOG=.ngrok.log

args=(http "$PORT" --log=stdout --log-format=json)
if [ -n "${NGROK_DOMAIN:-}" ]; then
  args+=("--url=https://${NGROK_DOMAIN#https://}")
fi

ngrok "${args[@]}" >"$LOG" 2>&1 &
ngrok_pid=$!
trap 'kill "$ngrok_pid" 2>/dev/null || true' EXIT

url=""
for _ in $(seq 1 50); do
  url=$(grep -o '"url":"https://[^"]*"' "$LOG" | head -1 | cut -d'"' -f4 || true)
  [ -n "$url" ] && break
  if ! kill -0 "$ngrok_pid" 2>/dev/null; then
    echo "ngrok exited before the tunnel came up:" >&2
    cat "$LOG" >&2
    exit 1
  fi
  sleep 0.2
done

if [ -z "$url" ]; then
  echo "Timed out waiting for ngrok. Log: $LOG" >&2
  exit 1
fi

echo "ngrok tunnel: $url -> localhost:$PORT"
echo "Make sure $url is registered as a redirect URI in the MYOB developer dashboard."
echo

MYOB_REDIRECT_URI="$url" PORT="$PORT" node --env-file-if-exists=.env runner/index.js "$@"
