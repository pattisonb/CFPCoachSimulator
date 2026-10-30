"""Serve the game on this computer: the page from `web/` and `/api/...` from the dispatcher
(`app/api.py`), with the standard library only.

    python tools/dev_server.py [--port N] [--host H]

The dispatcher has no threads: an advance or a game day only sets its job running. Here one
lock serializes every dispatcher call, and a background thread plays the running job a step
(one week, or your game) at a time, taking the lock per step. The season status is read
without the lock, so the page's progress poll sees a week's games as they are played.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import api  # noqa: E402

WEB_DIR = (ROOT / "web").resolve()
PAGES = {"/": "index.html", "/season": "index.html", "/coach": "coach.html"}
STATUS = re.compile(r"^/api/season/([^/]+)/status$")
SEASON_ID = re.compile(r"^/api/season/([^/]+)/")

_lock = threading.Lock()          # one dispatcher call or step at a time
_stepping = False                 # a stepper thread is playing the running job (read and set under _lock)
_last_status: dict[str, dict] = {}   # season id -> the last status sent for it


def _step_loop() -> None:
    """Play the running job a step at a time until it stops running."""
    global _stepping
    while True:
        with _lock:
            try:
                if api.job().get("status") != "running" or api.step() is None:
                    _stepping = False
                    return
            except Exception:  # noqa: BLE001 - step() records sim failures itself; anything else ends the run here
                traceback.print_exc()
                _stepping = False
                return


def _start_stepping() -> None:
    """Called with _lock held, after a dispatcher call: start the stepper if a job now runs."""
    global _stepping
    if api.job().get("status") == "running" and not _stepping:
        _stepping = True
        threading.Thread(target=_step_loop, daemon=True).start()


def dispatch(method: str, target: str, body: dict | bytes | None) -> dict | bytes:
    """One API call: the status without the lock, everything else under it."""
    path = urllib.parse.urlsplit(target).path
    status = STATUS.match(path) if method == "GET" else None
    if status:
        sid = status.group(1)
        try:
            out = api.call(method, target, body)
        except RuntimeError:              # the sim thread changed the season while it was being read
            if sid not in _last_status:
                raise
            return _last_status[sid]
        _last_status[sid] = out
        return out
    with _lock:
        out = api.call(method, target, body)
        _start_stepping()
        return out


class Handler(BaseHTTPRequestHandler):
    server_version = "CoachCareerDev"

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_DELETE(self) -> None:
        self._handle("DELETE")

    def do_PUT(self) -> None:
        self._handle("PUT")

    def _handle(self, method: str) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api" or path.startswith("/api/"):
            self._api(method, path)
        elif method == "GET":
            self._static(path)
        else:
            self._send(405, b'{"detail":"method not allowed"}', "application/json")

    def _body(self) -> dict | bytes | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() == "application/json":
            return json.loads(raw)
        return raw

    def _api(self, method: str, path: str) -> None:
        try:
            body = self._body()
        except ValueError:
            return self._json(400, {"detail": "invalid JSON"})
        try:
            out = dispatch(method, self.path, body)
        except api.ApiError as exc:
            return self._json(exc.status, {"detail": exc.message})
        except Exception as exc:  # noqa: BLE001 - the page shows the error; the server stays up
            traceback.print_exc()
            return self._json(500, {"detail": str(exc)})
        if isinstance(out, (bytes, bytearray)):
            m = SEASON_ID.match(path)
            sid = urllib.parse.unquote(m.group(1)) if m else "save"
            return self._send(200, bytes(out), "application/gzip",
                              {"Content-Disposition": f'attachment; filename="coach-career-{sid}.ccsave"'})
        self._json(200, out)

    def _static(self, path: str) -> None:
        name = PAGES.get(path, urllib.parse.unquote(path).lstrip("/"))
        file = (WEB_DIR / name).resolve()
        if not file.is_relative_to(WEB_DIR) or not file.is_file():
            return self._json(404, {"detail": "not found"})
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self._send(200, file.read_bytes(), ctype)

    def _json(self, code: int, data: dict) -> None:
        self._send(code, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), "application/json")

    def _send(self, code: int, data: bytes, ctype: str, headers: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    ap = argparse.ArgumentParser(description="Serve Coach Career on this computer.")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Coach Career: http://{args.host}:{args.port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
