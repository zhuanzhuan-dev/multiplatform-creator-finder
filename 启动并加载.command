#!/bin/zsh
set -euo pipefail
EXT="$(cd "$(dirname "$0")" && pwd)"
cd "$EXT"
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "需要 Node.js 22，当前版本：$(node --version)"
  exit 1
fi
pnpm install --frozen-lockfile
pnpm build
DIST="$EXT/dist"
PROFILE="$HOME/.chrome-douyin-finder"
PORT=9333
if ! curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
  open -na "Google Chrome" --args \
    --user-data-dir="$PROFILE" \
    --enable-unsafe-extension-debugging \
    --remote-debugging-port="$PORT" \
    --no-first-run \
    --no-default-browser-check \
    chrome://extensions
  for i in {1..20}; do
    curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null && break
    sleep 0.3
  done
fi
python3 - "$DIST" <<'PY'
import json, urllib.request, base64, socket, os, sys
from urllib.parse import urlparse
ext = sys.argv[1]
version = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json/version"))
u = urlparse(version["webSocketDebuggerUrl"])
key = base64.b64encode(os.urandom(16)).decode()
req = (f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode()
s = socket.create_connection((u.hostname, u.port), timeout=10)
s.sendall(req)
header = b""
while b"\r\n\r\n" not in header:
    header += s.recv(4096)
raw = json.dumps({"id": 1, "method": "Extensions.loadUnpacked", "params": {"path": ext}}).encode()
frame = bytearray([0x81]); n=len(raw); mask=os.urandom(4)
frame.append(0x80 | n if n < 126 else 0x80 | 126)
if n >= 126: frame.extend(n.to_bytes(2, "big"))
frame.extend(mask); frame.extend(bytes(b ^ mask[i%4] for i,b in enumerate(raw)))
s.sendall(frame)
hdr=s.recv(2); ln=hdr[1]&0x7F
if ln==126: ln=int.from_bytes(s.recv(2),"big")
data=b""
while len(data)<ln: data += s.recv(ln-len(data))
print(data.decode())
s.close()
PY
