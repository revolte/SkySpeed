# ⚡ SkySpeed — Next-Gen Internet Speed Test & Network Diagnostics

SkySpeed is a precision internet speed testing and network diagnostics suite built from the ground up with zero external dependencies (Python 3 standard library only). It provides a responsive web UI, terminal CLI tool, REST API, and dual edge/LAN testing engine.

---

## 🌟 Key Features

- **Triple-Engine Testing**:
  1. **Global Edge CDN**: Measures true internet bandwidth against the closest Cloudflare edge nodes worldwide.
  2. **Local LAN Mode**: Benchmarks throughput between browser/client and local host to diagnose WiFi bottlenecks vs ISP limits.
  3. **Server Internet Test**: Runs speed tests directly on the host machine with real-time Server-Sent Events (SSE) streaming.
- **Accurate Real-Time Metrics**:
  - **Download Speed** (Instant, Average, Peak)
  - **Upload Speed** (Multi-stream concurrent upload throughput)
  - **Idle Latency & Jitter** (Millisecond precision RTT statistical spread)
  - **Loaded Latency & Bufferbloat Grade** (A+ through F ratings under network saturation)
  - **Connection Stability** & Transferred Data volume tracking
- **Dynamic Physics Speedometer**:
  - Auto-scaling SVG needle and circular glowing arc (50, 100, 250, 500, 1000+ Mbps adaptive scales).
- **Live Speed Waveform Graph**:
  - Hardware-accelerated HTML5 Canvas displaying 60fps bezier throughput curves.
- **Network Intelligence**:
  - Public IP detection with privacy toggle (mask/reveal)
  - ISP & ASN identification (e.g., Maroc Telecom, AS36903)
  - Geographic city, country, and edge datacenter identification
- **Application Suitability Ratings**:
  - 🎮 Competitive Esports / Gaming suitability
  - 📺 4K UHD Video Streaming capability
  - 🎙️ Zoom / HD Video Conferencing quality
- **History & Analytics**:
  - Persistent run history with timestamps, modes, grades, and metrics.
  - One-click **Export to CSV**.
  - One-click **Copy Result Summary** to clipboard.
  - **Generate High-Res Result Card**: Renders and downloads a 1200x630 PNG share card directly via Canvas.
- **Audio Feedback**:
  - Web Audio API synthesized tones for start, phase transitions, and test completion (muteable).
- **Themes & Units**:
  - Dark & Light mode toggle.
  - Speed unit switcher: Mbps, MB/s, Kbps.

---

## 🚀 Quick Start

### 1. Web Application Mode

Run the web server:
```bash
cd /home/revolte/speedtest_app
./run.sh
# or:
python3 app.py --port 8080
```

Open your browser to:
- **Local machine**: `http://localhost:8080`
- **Other devices on your WiFi/LAN**: `http://<your-lan-ip>:8080`

### 2. Terminal CLI Mode

Run a complete speed test directly in your terminal:
```bash
python3 /home/revolte/speedtest_app/app.py --cli
```

Example CLI Output:
```text
⚡ SkySpeed — Internet Speed & Network Diagnostics CLI
==================================================================
[✓] Network: Office National des Postes et Telecommunications ONPT Maroc Telecom / IAM (AS36903) | 🇲🇦 Rabat, Morocco | IP: 196.75.77.251        
[✓] Ping: 114.0 ms (min: 105.5ms, max: 131.5ms) | Jitter: 11.4 ms        
[✓] Download: 179.27 Mbps (Peak: 565.54 Mbps, Transferred: 152.5 MB)        
[✓] Upload:   88.77 Mbps (Peak: 167.63 Mbps, Transferred: 66.0 MB)        

═══════════════════════ TEST RESULTS SUMMARY ═══════════════════════
  DOWNLOAD:       179.27 Mbps   (Peak: 565.54 Mbps)
  UPLOAD:          88.77 Mbps   (Peak: 167.63 Mbps)
  PING:            114.0 ms     (Jitter: 11.4 ms)
  BUFFERBLOAT:         A        (Delta: +6.0 ms)
───────────────────────────────────────────────────────────────────
  Provider:     Office National des Postes et Telecommunications ONPT Maroc Telecom / IAM (AS36903)
  Location:     Rabat, Morocco
  Timestamp:    2026-10-28 13:06:10
───────────────────────────────────────────────────────────────────
  🎮 Gaming / Esports:   ★★★☆☆ Good
  📺 Video Streaming:    ★★★★★ 4K Ultra HD
  🎙️ Video Calls / WFH:  ★★★★★ Seamless HD
═══════════════════════════════════════════════════════════════════
```

---

## 📡 REST API Reference

SkySpeed includes a built-in JSON / Binary streaming API:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/ip` | `GET` | Returns client/host public IP, ISP name, ASN, and geo-location |
| `/api/ping` | `GET` | Low-latency 204 endpoint for measuring network RTT |
| `/api/down?bytes=N` | `GET` | High-throughput chunk generator for local LAN download tests |
| `/api/up` | `POST` | High-throughput sink measuring client upload bandwidth |
| `/api/server-test` | `GET` | Streams server-side speed test progress via Server-Sent Events (SSE) |
| `/api/history` | `GET` | Fetches test run history JSON |
| `/api/history` | `POST` | Appends a test result to the history file |
| `/api/history` | `DELETE` | Clears all history records |

---

## 📁 Project Structure

```text
speedtest_app/
├── app.py             # HTTP server, CLI runner, test engine, and REST API
├── run.sh             # Quick startup script
├── history.json       # Persistent test history
├── README.md          # Documentation and user manual
└── static/
    ├── index.html     # Single-page modern interface
    ├── style.css      # Glassmorphism, animations, dark/light themes
    └── app.js         # Canvas waveform, SVG gauge physics, audio, fetch streams
```

---

## 🛡️ Zero Dependencies

No `pip install` or external build tools required. Runs on vanilla Python 3.8+ and any modern web browser.
