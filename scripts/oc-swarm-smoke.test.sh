#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SMOKE_LOG="$TMP_DIR/smoke.log"
SMOKE_PIDS="$TMP_DIR/pids.txt"
export OMOC_SMOKE_LOG="$SMOKE_LOG"
export OMOC_SMOKE_PIDS="$SMOKE_PIDS"

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/project/.opencode/plugins"
cp "$ROOT_DIR/bin/oc-swarm" "$TMP_DIR/bin/oc-swarm"
cp "$ROOT_DIR/templates/bin/opencode" "$TMP_DIR/bin/opencode"
chmod +x "$TMP_DIR/bin/oc-swarm" "$TMP_DIR/bin/opencode"

cat > "$TMP_DIR/bin/lsof" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$TMP_DIR/bin/lsof"

cat > "$TMP_DIR/bin/jq" <<'EOF'
#!/usr/bin/env bash
node -e 'const fs=require("node:fs"); const input=fs.readFileSync(0,"utf8"); const m=input.match(/"id"\s*:\s*"([^"]+)"/); if (!m) process.exit(1); process.stdout.write(m[1]);'
EOF
chmod +x "$TMP_DIR/bin/jq"

cat > "$TMP_DIR/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG="${OMOC_SMOKE_LOG:?}"
printf 'curl %s\n' "$*" >> "$LOG"
if [[ "$*" == *"/path?directory="* ]]; then
  printf '{"ok":true}'
  exit 0
fi
if [[ "$*" == *"/session?directory="* ]]; then
  body=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d)
        body="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  if [[ "$body" == *'"title":"'*":root"* ]]; then
    printf '{"id":"root-session"}'
  elif [[ "$body" == *'planner'* ]]; then
    printf '{"id":"planner-session"}'
  elif [[ "$body" == *'researcher'* ]]; then
    printf '{"id":"researcher-session"}'
  elif [[ "$body" == *'coder'* ]]; then
    printf '{"id":"coder-session"}'
  elif [[ "$body" == *'reviewer'* ]]; then
    printf '{"id":"reviewer-session"}'
  else
    printf '{"id":"session-%s"}' "$$"
  fi
  exit 0
fi
printf '{}'
EOF
chmod +x "$TMP_DIR/bin/curl"

cat > "$TMP_DIR/bin/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG="${OMOC_SMOKE_LOG:?}"
PIDS="${OMOC_SMOKE_PIDS:?}"
COUNT_FILE="${OMOC_SMOKE_COUNT:-/tmp/omoc-count}"
cmd="${*: -1}"
printf 'tmux %s\n' "$*" >> "$LOG"
case "${1:-}" in
  has-session)
    exit 1
    ;;
  new-session)
    bash -lc "$cmd" >> "$LOG" 2>&1 &
    echo "$!" >> "$PIDS"
    exit 0
    ;;
  new-window|split-window)
    count=0
    if [[ -f "$COUNT_FILE" ]]; then
      count="$(cat "$COUNT_FILE")"
    fi
    count=$((count + 1))
    printf '%s' "$count" > "$COUNT_FILE"
    bash -lc "$cmd" >> "$LOG" 2>&1 &
    echo "$!" >> "$PIDS"
    printf 'pane-%s\n' "$count"
    exit 0
    ;;
  attach|select-layout|select-pane|select-window|rename-window|set-option)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x "$TMP_DIR/bin/tmux"

cat > "$TMP_DIR/bin/opencode" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LOG="${OMOC_SMOKE_LOG:?}"
if [[ "${1:-}" == "serve" ]]; then
  shift
  port="4096"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port)
        port="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  node - "$port" <<'NODE' >> "$LOG" 2>&1 &
const http = require('node:http');
const port = Number(process.argv[2]);
const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/path')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url?.startsWith('/session') && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const title = /"title":"([^"]+)"/.exec(body)?.[1] ?? 'session';
    const id = title.includes(':root')
      ? 'root-session'
      : title.includes('planner')
        ? 'planner-session'
        : title.includes('researcher')
          ? 'researcher-session'
          : title.includes('coder')
            ? 'coder-session'
            : title.includes('reviewer')
              ? 'reviewer-session'
              : `session-${Math.random().toString(36).slice(2, 8)}`;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
server.listen(port, '127.0.0.1');
setInterval(() => {}, 1 << 30);
NODE
  exit 0
fi
if [[ "${1:-}" == "attach" ]]; then
  printf 'attach %s\n' "$*" >> "$LOG"
  exit 0
fi
printf 'opencode %s\n' "$*" >> "$LOG"
exit 0
EOF
chmod +x "$TMP_DIR/bin/opencode"

mkdir -p "$TMP_DIR/project/.opencode/plugins"
printf 'export default {}\n' > "$TMP_DIR/project/.opencode/plugins/omoc-swarm.ts"

PATH="$TMP_DIR/bin:$PATH" "$ROOT_DIR/bin/oc-swarm" --dir "$TMP_DIR/project" --id smoke >/dev/null 2>&1 || {
  cat "$SMOKE_LOG" >&2 || true
  exit 1
}

grep -q 'opencode serve' "$SMOKE_LOG"
grep -q 'attach' "$SMOKE_LOG"
grep -q 'planner-session' "$SMOKE_LOG"
grep -q 'researcher-session' "$SMOKE_LOG"
grep -q 'coder-session' "$SMOKE_LOG"
grep -q 'reviewer-session' "$SMOKE_LOG"

if [[ -f "$SMOKE_PIDS" ]]; then
  while IFS= read -r pid; do
    kill "$pid" >/dev/null 2>&1 || true
  done < "$SMOKE_PIDS"
fi

echo "oc-swarm smoke test passed"
