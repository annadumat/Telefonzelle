#!/usr/bin/env python3
"""
Telefonzelle – lokaler Server für den "Anruf in die Zukunft".

- liefert die Website aus (Ordner ./public, Videos in ./public/videos)
- nimmt Aufnahmen per POST /api/upload entgegen und speichert sie in ./recordings
- braucht nur Python 3 (Standardbibliothek), funktioniert komplett offline

Start:
    python3 server.py              -> http://localhost:8000  (Laptop selbst als Gerät)
    python3 server.py --https      -> https://<IP-des-Laptops>:8443 (iPad / Handy im selben WLAN)

Warum HTTPS fürs iPad? Browser erlauben Mikrofon/Kamera nur auf "sicheren" Seiten.
"localhost" gilt als sicher, eine IP-Adresse im WLAN aber nur mit HTTPS.
"""
import argparse
import datetime as dt
import json
import os
import re
import socket
import shutil
import ssl
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
RECORDINGS = os.path.join(ROOT, "recordings")
CERT_DIR = os.path.join(ROOT, "cert")

MAX_UPLOAD = 500 * 1024 * 1024  # 500 MB pro Aufnahme
FFMPEG = shutil.which("ffmpeg")
CONVERT = True  # per --ohne-konvertierung abschaltbar
SAFE = re.compile(r"[^A-Za-z0-9_\-]")

EXT_BY_MIME = {
    "audio/webm": "webm", "video/webm": "webm",
    "audio/mp4": "m4a", "video/mp4": "mp4",
    "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-m4a": "m4a",
}


def safe(name, fallback="x"):
    name = SAFE.sub("_", name or "")[:80]
    return name or fallback


class Handler(SimpleHTTPRequestHandler):
    server_version = "Telefonzelle/1.0"

    def translate_path(self, path):
        p = urlparse(path).path
        base, rel = PUBLIC, p.lstrip("/")
        full = os.path.normpath(os.path.join(base, rel))
        if not full.startswith(base):
            return os.path.join(PUBLIC, "__forbidden__")
        return full

    def end_headers(self):
        # Keine Zwischenspeicherung: geänderte Videos/Config greifen sofort.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/api/ping":
            return self._json(200, {"ok": True, "server": "telefonzelle"})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/upload":
            return self._upload()
        if path == "/api/log":
            return self._log()
        self._json(404, {"error": "not found"})

    def _session_dir(self):
        session = safe(self.headers.get("X-Session"), "unbekannt")
        d = os.path.join(RECORDINGS, session)
        os.makedirs(d, exist_ok=True)
        return d

    def _upload(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD:
            return self._json(413, {"error": "invalid size"})
        mime = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        ext = EXT_BY_MIME.get(mime, "bin")
        name = safe(self.headers.get("X-Name"), "aufnahme")
        d = self._session_dir()
        target = os.path.join(d, f"{name}.{ext}")
        n = 2
        while os.path.exists(target):
            target = os.path.join(d, f"{name}_{n}.{ext}")
            n += 1
        remaining = length
        with open(target, "wb") as f:
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 16, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        rel = os.path.relpath(target, ROOT)
        print(f"  [gespeichert] {rel} ({length // 1024} KB)")
        if CONVERT and FFMPEG:
            threading.Thread(target=convert, args=(target, mime.startswith("video")), daemon=True).start()
        self._json(200, {"ok": True, "file": rel})

    def _log(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 1024 * 1024:
            return self._json(413, {"error": "invalid size"})
        data = self.rfile.read(length)
        try:
            json.loads(data)
        except ValueError:
            return self._json(400, {"error": "invalid json"})
        with open(os.path.join(self._session_dir(), "anruf.json"), "wb") as f:
            f.write(data)
        self._json(200, {"ok": True})

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or "") or (args and str(args[1]) >= "400"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def convert(path, is_video):
    """Erzeugt zusätzlich eine überall abspielbare Kopie (MP3 bzw. H.264-MP4)."""
    base = os.path.splitext(path)[0]
    if is_video:
        out = base + "_konvertiert.mp4"
        args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]
    else:
        out = base + ".mp3"
        args = ["-vn", "-c:a", "libmp3lame", "-q:a", "2"]
    try:
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", path, *args, out],
                       check=True, capture_output=True, timeout=600)
        print(f"  [konvertiert] {os.path.relpath(out, ROOT)}")
    except Exception as e:  # Original bleibt in jedem Fall erhalten
        print(f"  [konvertierung fehlgeschlagen] {os.path.relpath(path, ROOT)}: {e}")


def local_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # kein echter Verkehr, nur Routing-Abfrage
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips.discard("127.0.0.1")
    return sorted(ips)


def ensure_cert(ips):
    os.makedirs(CERT_DIR, exist_ok=True)
    cert, key = os.path.join(CERT_DIR, "cert.pem"), os.path.join(CERT_DIR, "key.pem")
    if os.path.exists(cert) and os.path.exists(key):
        return cert, key
    san = ",".join(["DNS:localhost", "IP:127.0.0.1"] + [f"IP:{ip}" for ip in ips])
    cmd = ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650",
           "-keyout", key, "-out", cert, "-subj", "/CN=Telefonzelle",
           "-addext", f"subjectAltName={san}"]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError) as e:
        sys.exit("Konnte kein Zertifikat erzeugen (ist 'openssl' installiert?): %s" % e)
    print("  Neues Zertifikat erzeugt in ./cert")
    return cert, key


def main():
    ap = argparse.ArgumentParser(description="Telefonzelle – Anruf in die Zukunft")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--https", action="store_true", help="HTTPS (nötig für iPad/Handy im WLAN)")
    ap.add_argument("--ohne-konvertierung", action="store_true",
                    help="keine zusätzliche MP3/MP4-Kopie per ffmpeg erzeugen")
    args = ap.parse_args()
    global CONVERT
    CONVERT = not args.ohne_konvertierung
    port = args.port or (8443 if args.https else 8000)

    os.makedirs(RECORDINGS, exist_ok=True)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    scheme = "http"
    ips = local_ips()
    if args.https:
        cert, key = ensure_cert(ips)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"

    print("\n  Telefonzelle läuft  –  Aufnahmen landen in:\n  " + RECORDINGS)
    if CONVERT:
        print("  MP3/MP4-Kopien: " + ("an (ffmpeg gefunden)" if FFMPEG else "aus (ffmpeg nicht installiert)"))
    print()
    print(f"  Auf diesem Gerät:   {scheme}://localhost:{port}")
    for ip in ips:
        print(f"  Im Netzwerk:        {scheme}://{ip}:{port}")
    if not args.https and ips:
        print("\n  Hinweis: Für iPad/Handy mit  --https  starten, sonst blockiert der")
        print("  Browser das Mikrofon.")
    print("\n  Beenden mit Strg+C\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server beendet.")


if __name__ == "__main__":
    main()
