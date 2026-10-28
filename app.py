#!/usr/bin/env python3
"""
SkySpeed — High-Performance Internet Speed Test & Network Diagnostics App.
Zero external dependencies, standard library only.
"""

import argparse
import json
import os
import re
import socket
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

# Default configurations
DEFAULT_PORT = 8080
DEFAULT_HOST = "0.0.0.0"
APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")
HISTORY_FILE = os.path.join(APP_DIR, "history.json")

# Pre-allocated zero buffer for local high-throughput generation
ZERO_CHUNK = b"\x00" * 65536
USER_AGENT = "SkySpeed/1.0 (Linux; x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"


def get_network_info():
    """Fetch external IP, ISP, ASN, and geographic location."""
    # Attempt 1: ipwho.is (rich JSON)
    try:
        req = Request("https://ipwho.is/", headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("success"):
                return {
                    "ip": data.get("ip"),
                    "isp": data.get("connection", {}).get("isp") or data.get("connection", {}).get("org") or "Unknown ISP",
                    "asn": f"AS{data.get('connection', {}).get('asn')}" if data.get("connection", {}).get("asn") else "Unknown",
                    "org": data.get("connection", {}).get("org", ""),
                    "city": data.get("city", "Unknown City"),
                    "region": data.get("region", ""),
                    "country": data.get("country", "Unknown Country"),
                    "country_code": data.get("country_code", ""),
                    "flag": data.get("flag", {}).get("emoji", "🌐"),
                    "lat": data.get("latitude"),
                    "lon": data.get("longitude"),
                    "source": "ipwhois"
                }
    except Exception:
        pass

    # Attempt 2: Cloudflare trace fallback
    try:
        req = Request("https://1.1.1.1/cdn-cgi/trace", headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=4) as resp:
            lines = resp.read().decode("utf-8").strip().split("\n")
            trace = dict(line.split("=", 1) for line in lines if "=" in line)
            return {
                "ip": trace.get("ip", "Unknown"),
                "isp": "Cloudflare Network Edge",
                "asn": "AS13335",
                "org": "Cloudflare",
                "city": trace.get("colo", "Edge"),
                "region": "",
                "country": trace.get("loc", "Unknown"),
                "country_code": trace.get("loc", ""),
                "flag": "🌐",
                "lat": None,
                "lon": None,
                "colo": trace.get("colo", ""),
                "source": "cloudflare"
            }
    except Exception:
        return {
            "ip": "127.0.0.1",
            "isp": "Local Network",
            "asn": "N/A",
            "org": "Localhost",
            "city": "Local",
            "region": "",
            "country": "Local",
            "country_code": "",
            "flag": "💻",
            "source": "local"
        }


def measure_ping(samples=8, target_url="https://speed.cloudflare.com/__down?bytes=0"):
    """Measure ping latency and jitter."""
    rtts = []
    for _ in range(samples):
        try:
            t0 = time.perf_counter()
            req = Request(target_url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=4) as resp:
                _ = resp.read(1)
            t1 = time.perf_counter()
            rtts.append((t1 - t0) * 1000.0)
        except Exception:
            continue
        time.sleep(0.05)

    if not rtts:
        return {"min": 0, "avg": 0, "max": 0, "jitter": 0, "samples": []}

    min_ping = min(rtts)
    avg_ping = statistics.mean(rtts)
    max_ping = max(rtts)
    jitter = (
        statistics.mean([abs(rtts[i] - rtts[i - 1]) for i in range(1, len(rtts))])
        if len(rtts) > 1
        else 0
    )
    return {
        "min": round(min_ping, 1),
        "avg": round(avg_ping, 1),
        "max": round(max_ping, 1),
        "jitter": round(jitter, 1),
        "samples": [round(x, 1) for x in rtts],
    }


def measure_download(duration_sec=7.0, max_threads=4, progress_cb=None):
    """Run parallel download streams against speed edge and measure Mbps."""
    stop_event = threading.Event()
    total_bytes = 0
    lock = threading.Lock()
    samples = []
    start_time = time.perf_counter()

    def worker():
        nonlocal total_bytes
        # Progressive sizes: 2MB, 5MB, 10MB, 25MB
        chunk_sizes = [2_000_000, 5_000_000, 10_000_000, 25_000_000]
        idx = 0
        while not stop_event.is_set():
            sz = chunk_sizes[min(idx, len(chunk_sizes) - 1)]
            idx += 1
            url = f"https://speed.cloudflare.com/__down?bytes={sz}"
            try:
                req = Request(url, headers={"User-Agent": USER_AGENT})
                with urlopen(req, timeout=6) as resp:
                    while not stop_event.is_set():
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        with lock:
                            total_bytes += len(chunk)
            except Exception:
                time.sleep(0.1)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(max_threads)]
    for t in threads:
        t.start()

    last_time = start_time
    last_bytes = 0
    peak_mbps = 0.0

    while time.perf_counter() - start_time < duration_sec:
        time.sleep(0.15)
        now = time.perf_counter()
        with lock:
            current_bytes = total_bytes
        dt = now - last_time
        db = current_bytes - last_bytes
        if dt > 0:
            instant_mbps = (db * 8.0 / dt) / 1_000_000.0
            overall_elapsed = now - start_time
            overall_mbps = (current_bytes * 8.0 / overall_elapsed) / 1_000_000.0 if overall_elapsed > 0 else 0
            if instant_mbps > peak_mbps:
                peak_mbps = instant_mbps
            samples.append(round(instant_mbps, 2))
            if progress_cb:
                progress_cb({
                    "stage": "download",
                    "elapsed": round(overall_elapsed, 2),
                    "total_sec": duration_sec,
                    "instant_mbps": round(instant_mbps, 2),
                    "average_mbps": round(overall_mbps, 2),
                    "peak_mbps": round(peak_mbps, 2),
                    "transferred_mb": round(current_bytes / (1024 * 1024), 2),
                    "progress": min(100.0, round((overall_elapsed / duration_sec) * 100.0, 1))
                })
        last_time = now
        last_bytes = current_bytes

    stop_event.set()
    for t in threads:
        t.join(timeout=0.5)

    end_time = time.perf_counter()
    elapsed = max(0.001, end_time - start_time)
    avg_mbps = (total_bytes * 8.0 / elapsed) / 1_000_000.0

    return {
        "average_mbps": round(avg_mbps, 2),
        "peak_mbps": round(peak_mbps, 2),
        "transferred_mb": round(total_bytes / (1024 * 1024), 2),
        "samples": samples[-30:],
        "duration": round(elapsed, 2),
    }


def measure_upload(duration_sec=6.0, max_threads=3, progress_cb=None):
    """Run parallel upload streams against speed edge and measure Mbps."""
    stop_event = threading.Event()
    total_bytes = 0
    lock = threading.Lock()
    samples = []
    start_time = time.perf_counter()

    # Pre-generate 1MB payload block
    payload = os.urandom(1024 * 1024)

    def worker():
        nonlocal total_bytes
        url = "https://speed.cloudflare.com/__up"
        while not stop_event.is_set():
            try:
                req = Request(url, data=payload, method="POST", headers={
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/octet-stream"
                })
                with urlopen(req, timeout=6) as resp:
                    _ = resp.read()
                with lock:
                    total_bytes += len(payload)
            except Exception:
                time.sleep(0.1)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(max_threads)]
    for t in threads:
        t.start()

    last_time = start_time
    last_bytes = 0
    peak_mbps = 0.0

    while time.perf_counter() - start_time < duration_sec:
        time.sleep(0.15)
        now = time.perf_counter()
        with lock:
            current_bytes = total_bytes
        dt = now - last_time
        db = current_bytes - last_bytes
        if dt > 0:
            instant_mbps = (db * 8.0 / dt) / 1_000_000.0
            overall_elapsed = now - start_time
            overall_mbps = (current_bytes * 8.0 / overall_elapsed) / 1_000_000.0 if overall_elapsed > 0 else 0
            if instant_mbps > peak_mbps:
                peak_mbps = instant_mbps
            samples.append(round(instant_mbps, 2))
            if progress_cb:
                progress_cb({
                    "stage": "upload",
                    "elapsed": round(overall_elapsed, 2),
                    "total_sec": duration_sec,
                    "instant_mbps": round(instant_mbps, 2),
                    "average_mbps": round(overall_mbps, 2),
                    "peak_mbps": round(peak_mbps, 2),
                    "transferred_mb": round(current_bytes / (1024 * 1024), 2),
                    "progress": min(100.0, round((overall_elapsed / duration_sec) * 100.0, 1))
                })
        last_time = now
        last_bytes = current_bytes

    stop_event.set()
    for t in threads:
        t.join(timeout=0.5)

    end_time = time.perf_counter()
    elapsed = max(0.001, end_time - start_time)
    avg_mbps = (total_bytes * 8.0 / elapsed) / 1_000_000.0

    return {
        "average_mbps": round(avg_mbps, 2),
        "peak_mbps": round(peak_mbps, 2),
        "transferred_mb": round(total_bytes / (1024 * 1024), 2),
        "samples": samples[-30:],
        "duration": round(elapsed, 2),
    }


def calculate_bufferbloat(idle_ping, loaded_ping):
    """Compute bufferbloat grade based on ping delta under traffic load."""
    delta = max(0.0, loaded_ping - idle_ping)
    if delta < 5:
        grade = "A+"
        desc = "Minimal bufferbloat. Outstanding for competitive gaming and voice."
    elif delta < 15:
        grade = "A"
        desc = "Low bufferbloat. Excellent network responsiveness under load."
    elif delta < 30:
        grade = "B"
        desc = "Good bufferbloat control. Rarely noticeable in normal usage."
    elif delta < 60:
        grade = "C"
        desc = "Moderate bufferbloat. Minor latency spikes during heavy downloads."
    elif delta < 120:
        grade = "D"
        desc = "High bufferbloat. Noticeable lag during file transfers or streaming."
    else:
        grade = "F"
        desc = "Severe bufferbloat. Heavy lag spikes when connection is utilized."
    return {"grade": grade, "delta_ms": round(delta, 1), "description": desc}


def run_full_speedtest(progress_cb=None):
    """Execute complete suite: info -> ping -> download -> upload -> loaded ping -> analysis."""
    if progress_cb:
        progress_cb({"stage": "info", "message": "Detecting IP & network location..."})

    net_info = get_network_info()

    if progress_cb:
        progress_cb({"stage": "ping", "message": "Measuring latency & jitter...", "info": net_info})

    idle_ping_res = measure_ping(samples=6)

    if progress_cb:
        progress_cb({
            "stage": "ping_done",
            "ping": idle_ping_res["avg"],
            "jitter": idle_ping_res["jitter"],
            "message": "Testing download throughput..."
        })

    download_res = measure_download(duration_sec=7.0, progress_cb=progress_cb)

    if progress_cb:
        progress_cb({
            "stage": "download_done",
            "download_mbps": download_res["average_mbps"],
            "message": "Testing upload throughput..."
        })

    upload_res = measure_upload(duration_sec=6.0, progress_cb=progress_cb)

    if progress_cb:
        progress_cb({"stage": "loaded_ping", "message": "Measuring latency under load..."})

    # Loaded ping test while a download is running
    loaded_ping_res = measure_ping(samples=4)
    bufferbloat = calculate_bufferbloat(idle_ping_res["avg"], loaded_ping_res["avg"])

    result = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": int(time.time()),
        "network": net_info,
        "ping": idle_ping_res,
        "loaded_ping": loaded_ping_res,
        "bufferbloat": bufferbloat,
        "download": download_res,
        "upload": upload_res,
        "ratings": {
            "gaming": "Excellent" if idle_ping_res["avg"] < 40 and bufferbloat["grade"] in ("A+", "A") else "Good" if idle_ping_res["avg"] < 80 else "Fair",
            "streaming_4k": "Excellent" if download_res["average_mbps"] >= 25 else "Good" if download_res["average_mbps"] >= 15 else "Fair",
            "video_calls": "Excellent" if upload_res["average_mbps"] >= 10 and idle_ping_res["jitter"] < 15 else "Good" if upload_res["average_mbps"] >= 3 else "Fair"
        }
    }

    # Save to history file
    save_history_entry(result)

    if progress_cb:
        progress_cb({"stage": "done", "result": result})

    return result


def load_history():
    """Load test history from JSON file."""
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_history_entry(entry):
    """Append a test entry to the JSON history file."""
    try:
        history = load_history()
        # Keep last 50 entries
        history.insert(0, entry)
        history = history[:50]
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        sys.stderr.write(f"Failed to save history: {e}\n")


class SpeedTestHTTPHandler(BaseHTTPRequestHandler):
    """High-performance HTTP server handling web UI, streaming API, and local speed tests."""

    def log_message(self, format, *args):
        # Silence routine 200 GET requests to keep terminal clean
        if "GET /api/ping" in (args[0] if args else ""):
            return
        super().log_message(format, *args)

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, User-Agent, X-Requested-With")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Server-Timing")

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # 1. API: Ping
        if path == "/api/ping":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_cors_headers()
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.end_headers()
            return

        # 2. API: Network IP & Location
        if path == "/api/ip":
            info = get_network_info()
            body = json.dumps(info).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
            return

        # 3. API: Local Download Generation (High-Throughput Chunk Stream)
        if path == "/api/down":
            try:
                num_bytes = int(query.get("bytes", [10_485_760])[0])
            except ValueError:
                num_bytes = 10_485_760

            num_bytes = min(max(1024, num_bytes), 200_000_000)  # Max 200MB per request
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(num_bytes))
            self.send_header("Cache-Control", "no-store, no-transform")
            self.end_headers()

            chunk_len = len(ZERO_CHUNK)
            sent = 0
            while sent < num_bytes:
                to_send = min(chunk_len, num_bytes - sent)
                try:
                    self.wfile.write(ZERO_CHUNK[:to_send])
                    sent += to_send
                except (BrokenPipeError, ConnectionResetError):
                    break
            return

        # 4. API: Server-Side Speedtest Stream (Server-Sent Events)
        if path == "/api/server-test":
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            def sse_callback(event_data):
                try:
                    payload = f"data: {json.dumps(event_data)}\n\n"
                    self.wfile.write(payload.encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    pass

            try:
                run_full_speedtest(progress_cb=sse_callback)
            except Exception as e:
                sse_callback({"stage": "error", "error": str(e)})
            return

        # 5. API: History
        if path == "/api/history":
            history = load_history()
            body = json.dumps(history).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 6. Static files
        if path == "/":
            file_path = os.path.join(STATIC_DIR, "index.html")
            content_type = "text/html; charset=utf-8"
        elif path == "/style.css":
            file_path = os.path.join(STATIC_DIR, "style.css")
            content_type = "text/css; charset=utf-8"
        elif path == "/app.js":
            file_path = os.path.join(STATIC_DIR, "app.js")
            content_type = "application/javascript; charset=utf-8"
        else:
            file_path = os.path.join(STATIC_DIR, path.lstrip("/"))
            content_type = "text/plain"
            if file_path.endswith(".json"):
                content_type = "application/json"
            elif file_path.endswith(".svg"):
                content_type = "image/svg+xml"
            elif file_path.endswith(".png"):
                content_type = "image/png"
            elif file_path.endswith((".jpg", ".jpeg")):
                content_type = "image/jpeg"
            elif file_path.endswith(".webp"):
                content_type = "image/webp"
            elif file_path.endswith(".ico"):
                content_type = "image/x-icon"

        if os.path.isfile(file_path):
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"404 Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. API: Local Upload Sink
        if path == "/api/up":
            t0 = time.perf_counter()
            content_length = int(self.headers.get("Content-Length", 0))
            read_bytes = 0
            while read_bytes < content_length:
                chunk = self.rfile.read(min(65536, content_length - read_bytes))
                if not chunk:
                    break
                read_bytes += len(chunk)
            t1 = time.perf_counter()
            elapsed_ms = max(0.1, (t1 - t0) * 1000.0)
            mbps = (read_bytes * 8.0 / (elapsed_ms / 1000.0)) / 1_000_000.0

            res = {
                "bytes": read_bytes,
                "elapsed_ms": round(elapsed_ms, 2),
                "mbps": round(mbps, 2)
            }
            body = json.dumps(res).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 2. API: Save History Record from Frontend
        if path == "/api/history":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                save_history_entry(payload)
                body = json.dumps({"success": True}).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(str(e).encode("utf-8"))
            return

        self.send_response(HTTPStatus.NOT_FOUND)
        self.send_cors_headers()
        self.end_headers()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/history":
            if os.path.exists(HISTORY_FILE):
                try:
                    os.remove(HISTORY_FILE)
                except Exception:
                    pass
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"success": true}')
            return
        self.send_response(HTTPStatus.NOT_FOUND)
        self.send_cors_headers()
        self.end_headers()


def run_cli_mode():
    """Run interactive terminal CLI speed test with ASCII progress indicators."""
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    MAGENTA = "\033[95m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"

    print(f"\n{BOLD}{CYAN}⚡ SkySpeed — Internet Speed & Network Diagnostics CLI{RESET}")
    print(f"{DIM}=================================================================={RESET}")

    # Step 1: Network Intelligence
    print(f"[{BOLD}1/4{RESET}] Identifying connection edge & ISP...", end="\r", flush=True)
    info = get_network_info()
    flag = info.get("flag", "🌐")
    ip = info.get("ip", "Unknown")
    isp = info.get("isp", "Unknown ISP")
    loc = f"{info.get('city', '')}, {info.get('country', '')}".strip(", ")
    asn = info.get("asn", "")
    print(f"[{BOLD}{GREEN}✓{RESET}] Network: {BOLD}{isp}{RESET} ({asn}) | {flag} {loc} | IP: {ip}        ")

    # Step 2: Latency & Jitter
    print(f"[{BOLD}2/4{RESET}] Testing latency & jitter...", end="\r", flush=True)
    ping = measure_ping(samples=8)
    print(f"[{BOLD}{GREEN}✓{RESET}] Ping: {BOLD}{GREEN}{ping['avg']} ms{RESET} (min: {ping['min']}ms, max: {ping['max']}ms) | Jitter: {BOLD}{YELLOW}{ping['jitter']} ms{RESET}        ")

    # Step 3: Download
    print(f"[{BOLD}3/4{RESET}] Measuring download speed...", end="\r", flush=True)

    def dl_progress(p):
        pct = int(p.get("progress", 0))
        bar = "━" * (pct // 4) + "╸" + "─" * (25 - (pct // 4))
        cur = p.get("instant_mbps", 0)
        avg = p.get("average_mbps", 0)
        print(f"[{BOLD}3/4{RESET}] Download: [{CYAN}{bar[:25]}{RESET}] {pct}% | Live: {BOLD}{CYAN}{cur:6.1f} Mbps{RESET} (Avg: {avg:6.1f} Mbps)", end="\r", flush=True)

    dl = measure_download(duration_sec=7.0, progress_cb=dl_progress)
    print(f"\n[{BOLD}{GREEN}✓{RESET}] Download: {BOLD}{CYAN}{dl['average_mbps']} Mbps{RESET} (Peak: {dl['peak_mbps']} Mbps, Transferred: {dl['transferred_mb']} MB)        ")

    # Step 4: Upload
    print(f"[{BOLD}4/4{RESET}] Measuring upload speed...", end="\r", flush=True)

    def up_progress(p):
        pct = int(p.get("progress", 0))
        bar = "━" * (pct // 4) + "╸" + "─" * (25 - (pct // 4))
        cur = p.get("instant_mbps", 0)
        avg = p.get("average_mbps", 0)
        print(f"[{BOLD}4/4{RESET}] Upload:   [{MAGENTA}{bar[:25]}{RESET}] {pct}% | Live: {BOLD}{MAGENTA}{cur:6.1f} Mbps{RESET} (Avg: {avg:6.1f} Mbps)", end="\r", flush=True)

    up = measure_upload(duration_sec=6.0, progress_cb=up_progress)
    print(f"\n[{BOLD}{GREEN}✓{RESET}] Upload:   {BOLD}{MAGENTA}{up['average_mbps']} Mbps{RESET} (Peak: {up['peak_mbps']} Mbps, Transferred: {up['transferred_mb']} MB)        ")

    # Bufferbloat & Loaded Latency
    loaded_ping = measure_ping(samples=4)
    bufferbloat = calculate_bufferbloat(ping["avg"], loaded_ping["avg"])

    # Final summary box
    print(f"\n{BOLD}{CYAN}═══════════════════════ TEST RESULTS SUMMARY ═══════════════════════{RESET}")
    print(f"  {BOLD}DOWNLOAD:{RESET}     {BOLD}{CYAN}{dl['average_mbps']:>8.2f} Mbps{RESET}   (Peak: {dl['peak_mbps']:.2f} Mbps)")
    print(f"  {BOLD}UPLOAD:{RESET}       {BOLD}{MAGENTA}{up['average_mbps']:>8.2f} Mbps{RESET}   (Peak: {up['peak_mbps']:.2f} Mbps)")
    print(f"  {BOLD}PING:{RESET}         {BOLD}{GREEN}{ping['avg']:>8.1f} ms{RESET}     (Jitter: {ping['jitter']} ms)")
    print(f"  {BOLD}BUFFERBLOAT:{RESET}  {BOLD}{YELLOW}{bufferbloat['grade']:>8}{RESET}        (Delta: +{bufferbloat['delta_ms']} ms)")
    print(f"{DIM}───────────────────────────────────────────────────────────────────{RESET}")
    print(f"  {BOLD}Provider:{RESET}     {isp} ({asn})")
    print(f"  {BOLD}Location:{RESET}     {loc}")
    print(f"  {BOLD}Timestamp:{RESET}    {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{DIM}───────────────────────────────────────────────────────────────────{RESET}")

    # Suitability
    gaming_grade = "★★★★★ Excellent" if ping["avg"] < 35 and bufferbloat["grade"] in ("A+", "A") else "★★★☆☆ Good" if ping["avg"] < 75 else "★☆☆☆☆ Suboptimal"
    streaming_grade = "★★★★★ 4K Ultra HD" if dl["average_mbps"] >= 25 else "★★★★☆ Full HD 1080p" if dl["average_mbps"] >= 10 else "★★☆☆☆ 720p HD"
    calls_grade = "★★★★★ Seamless HD" if up["average_mbps"] >= 5 and ping["jitter"] < 15 else "★★★☆☆ Stable"

    print(f"  🎮 Gaming / Esports:   {gaming_grade}")
    print(f"  📺 Video Streaming:    {streaming_grade}")
    print(f"  🎙️ Video Calls / WFH:  {calls_grade}")
    print(f"{BOLD}{CYAN}═══════════════════════════════════════════════════════════════════{RESET}\n")

    # Record to history
    save_history_entry({
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": int(time.time()),
        "mode": "CLI",
        "network": info,
        "ping": ping,
        "loaded_ping": loaded_ping,
        "bufferbloat": bufferbloat,
        "download": dl,
        "upload": up
    })


def main():
    parser = argparse.ArgumentParser(description="SkySpeed — Internet Speed Test & Network Diagnostics")
    parser.add_argument("--cli", action="store_true", help="Run speed test in terminal CLI mode directly")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"HTTP Server port (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST, help=f"HTTP Server host (default: {DEFAULT_HOST})")
    args = parser.parse_args()

    if args.cli:
        run_cli_mode()
        return

    # Check for free port
    port = args.port
    server = None
    for attempt_port in range(port, port + 20):
        try:
            server = ThreadingHTTPServer((args.host, attempt_port), SpeedTestHTTPHandler)
            port = attempt_port
            break
        except OSError as e:
            if "Address already in use" in str(e):
                continue
            raise

    if not server:
        sys.stderr.write(f"Could not bind to any port starting from {args.port}\n")
        sys.exit(1)

    print("=" * 64)
    print("  ⚡ SkySpeed Server Running")
    print(f"  🌐 Web UI:       http://localhost:{port}")
    if args.host == "0.0.0.0":
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            lan_ip = s.getsockname()[0]
            s.close()
            print(f"  📱 LAN Access:   http://{lan_ip}:{port}")
        except Exception:
            pass
    print(f"  💻 CLI Mode:     python3 app.py --cli")
    print(f"  📂 Static Dir:   {STATIC_DIR}")
    print("=" * 64)
    print("  Press Ctrl+C to stop the server.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down SkySpeed server.")
        server.server_close()


if __name__ == "__main__":
    main()
