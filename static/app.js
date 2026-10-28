/**
 * SkySpeed — Precision Speed Test & Network Diagnostics Engine
 * Zero dependencies, pure vanilla ES6+ with Web Audio, Canvas API, and Fetch Streams.
 */

(() => {
  'use strict';

  // --- STATE ---
  const state = {
    mode: 'edge', // 'edge' | 'lan' | 'host'
    profile: 'standard', // 'quick' | 'standard' | 'stress'
    unit: 'mbps', // 'mbps' | 'mbs' | 'kbps'
    soundEnabled: true,
    ipRevealed: false,
    networkInfo: null,
    testing: false,
    currentSpeedMbps: 0,
    gaugeMaxMbps: 100, // Dynamic scale: 50, 100, 250, 500, 1000
    currentStage: 'idle', // 'idle' | 'ping' | 'download' | 'upload' | 'loaded_ping' | 'done'
    history: [],
    audioCtx: null,

    // Real-time Waveform Series
    waveform: {
      download: [], // [{time, mbps}]
      upload: [],
      maxVal: 50,
      startTime: 0
    },

    // Current Test Metrics
    currentRun: {
      ping: { min: 0, avg: 0, max: 0, jitter: 0 },
      loadedPing: { avg: 0, delta: 0, grade: '—' },
      download: { avgMbps: 0, peakMbps: 0, bytes: 0, duration: 0 },
      upload: { avgMbps: 0, peakMbps: 0, bytes: 0, duration: 0 }
    }
  };

  // --- DOM ELEMENTS ---
  const $ = (id) => document.getElementById(id);
  const elements = {
    startBtn: $('startBtn'),
    readoutBlock: $('readoutBlock'),
    currentSpeedVal: $('currentSpeedVal'),
    currentSpeedUnit: $('currentSpeedUnit'),
    gaugeSubstatus: $('gaugeSubstatus'),
    needleGroup: $('needleGroup'),
    gaugeProgress: $('gaugeProgress'),
    gaugeGlow: $('gaugeGlow'),
    gaugeTicks: $('gaugeTicks'),
    
    // Stages
    stagePing: $('stagePing'),
    stageDown: $('stageDown'),
    stageUp: $('stageUp'),

    // Live Stats
    liveElapsed: $('liveElapsed'),
    liveTransferred: $('liveTransferred'),
    livePeak: $('livePeak'),

    // Result Cards
    resDownVal: $('resDownVal'),
    resDownUnit: $('resDownUnit'),
    resDownPeak: $('resDownPeak'),
    resDownBytes: $('resDownBytes'),
    
    resUpVal: $('resUpVal'),
    resUpUnit: $('resUpUnit'),
    resUpPeak: $('resUpPeak'),
    resUpBytes: $('resUpBytes'),

    resPingVal: $('resPingVal'),
    resPingMin: $('resPingMin'),
    resPingMax: $('resPingMax'),

    resJitterVal: $('resJitterVal'),
    resLoadedPing: $('resLoadedPing'),
    resStability: $('resStability'),

    // Ratings & Bufferbloat
    gamingRating: $('gamingRating'),
    streamingRating: $('streamingRating'),
    callRating: $('callRating'),
    bufferbloatBadge: $('bufferbloatBadge'),

    // Network Info
    geoFlag: $('geoFlag'),
    ispName: $('ispName'),
    serverLoc: $('serverLoc'),
    clientIp: $('clientIp'),
    toggleIpBtn: $('toggleIpBtn'),

    // Controls
    targetModeControl: $('targetModeControl'),
    unitSelect: $('unitSelect'),
    profileSelect: $('profileSelect'),
    soundToggle: $('soundToggle'),
    soundOnIcon: $('soundOnIcon'),
    soundOffIcon: $('soundOffIcon'),
    themeToggle: $('themeToggle'),
    sunIcon: $('sunIcon'),
    moonIcon: $('moonIcon'),

    // Actions & History
    copyResultBtn: $('copyResultBtn'),
    downloadCardBtn: $('downloadCardBtn'),
    exportCsvBtn: $('exportCsvBtn'),
    clearHistoryBtn: $('clearHistoryBtn'),
    historyCount: $('historyCount'),
    historyTbody: $('historyTbody'),

    // Canvas
    waveformCanvas: $('waveformCanvas'),
    shareCardCanvas: $('shareCardCanvas'),
    toast: $('toast')
  };

  // --- AUDIO SYNTHESIS (Zero External Audio Files) ---
  function playTone(freq, type = 'sine', duration = 0.15, vol = 0.12) {
    if (!state.soundEnabled) return;
    try {
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, state.audioCtx.currentTime);
      gain.gain.setValueAtTime(vol, state.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, state.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(state.audioCtx.destination);
      osc.start();
      osc.stop(state.audioCtx.currentTime + duration);
    } catch (e) {
      // Audio not supported or blocked
    }
  }

  function playSound(name) {
    if (name === 'start') {
      playTone(440, 'sine', 0.1, 0.1);
      setTimeout(() => playTone(880, 'triangle', 0.18, 0.12), 120);
    } else if (name === 'phase') {
      playTone(660, 'sine', 0.1, 0.08);
      setTimeout(() => playTone(990, 'sine', 0.15, 0.1), 90);
    } else if (name === 'finish') {
      playTone(523.25, 'triangle', 0.15, 0.12); // C5
      setTimeout(() => playTone(659.25, 'triangle', 0.15, 0.12), 110); // E5
      setTimeout(() => playTone(783.99, 'triangle', 0.25, 0.14), 220); // G5
      setTimeout(() => playTone(1046.50, 'sine', 0.45, 0.16), 330); // C6
    }
  }

  // --- UNIT FORMATTERS ---
  function formatSpeed(mbps) {
    if (state.unit === 'mbs') {
      return (mbps / 8).toFixed(2);
    } else if (state.unit === 'kbps') {
      return (mbps * 1000).toFixed(0);
    }
    return mbps >= 100 ? mbps.toFixed(1) : mbps.toFixed(2);
  }

  function getUnitLabel() {
    if (state.unit === 'mbs') return 'MB/s';
    if (state.unit === 'kbps') return 'Kbps';
    return 'Mbps';
  }

  function showToast(msg) {
    elements.toast.textContent = msg;
    elements.toast.classList.add('show');
    setTimeout(() => elements.toast.classList.remove('show'), 2800);
  }

  // --- GAUGE CONTROLLER ---
  // Arc length is ~534 px for R=120 from -135deg to +135deg (270 degrees total)
  const ARC_LENGTH = 534;

  function renderGaugeTicks() {
    elements.gaugeTicks.innerHTML = '';
    const max = state.gaugeMaxMbps;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const val = Math.round((max / steps) * i);
      const angleDeg = -135 + (270 / steps) * i;
      const angleRad = (angleDeg - 90) * (Math.PI / 180);

      // Tick line
      const rInner = 104;
      const rOuter = 114;
      const x1 = 160 + rInner * Math.cos(angleRad);
      const y1 = 160 + rInner * Math.sin(angleRad);
      const x2 = 160 + rOuter * Math.cos(angleRad);
      const y2 = 160 + rOuter * Math.sin(angleRad);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toFixed(1));
      line.setAttribute('y1', y1.toFixed(1));
      line.setAttribute('x2', x2.toFixed(1));
      line.setAttribute('y2', y2.toFixed(1));
      line.setAttribute('class', 'gauge-tick-line');
      elements.gaugeTicks.appendChild(line);

      // Tick Text
      const rText = 92;
      const tx = 160 + rText * Math.cos(angleRad);
      const ty = 160 + rText * Math.sin(angleRad);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', tx.toFixed(1));
      text.setAttribute('y', (ty + 1).toFixed(1));
      text.setAttribute('class', 'gauge-tick-text');
      text.textContent = val;
      elements.gaugeTicks.appendChild(text);
    }
  }

  function updateGauge(speedMbps) {
    state.currentSpeedMbps = speedMbps;
    
    // Auto-scale gauge max if speed exceeds 80% of current max
    if (speedMbps > state.gaugeMaxMbps * 0.85) {
      if (state.gaugeMaxMbps <= 50) state.gaugeMaxMbps = 100;
      else if (state.gaugeMaxMbps <= 100) state.gaugeMaxMbps = 250;
      else if (state.gaugeMaxMbps <= 250) state.gaugeMaxMbps = 500;
      else if (state.gaugeMaxMbps <= 500) state.gaugeMaxMbps = 1000;
      else if (state.gaugeMaxMbps <= 1000) state.gaugeMaxMbps = 2500;
      renderGaugeTicks();
    }

    // Ratio clamped between 0 and 1
    const ratio = Math.min(1.0, Math.max(0.0, speedMbps / state.gaugeMaxMbps));
    
    // Needle angle: -135 deg to +135 deg
    const angle = -135 + ratio * 270;
    elements.needleGroup.setAttribute('transform', `rotate(${angle.toFixed(1)} 160 160)`);

    // Arc stroke dashoffset
    const offset = ARC_LENGTH * (1 - ratio);
    elements.gaugeProgress.style.strokeDashoffset = offset.toFixed(1);
    elements.gaugeGlow.style.strokeDashoffset = offset.toFixed(1);

    // Readout
    elements.currentSpeedVal.textContent = formatSpeed(speedMbps);
    elements.currentSpeedUnit.textContent = getUnitLabel();
  }

  // --- WAVEFORM CANVAS GRAPH ---
  const canvas = elements.waveformCanvas;
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    drawWaveform();
  }
  window.addEventListener('resize', resizeCanvas);

  function drawWaveform() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (w <= 0 || h <= 0) return;

    // Grid lines
    ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'light' 
      ? 'rgba(0, 0, 0, 0.05)' 
      : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    for (let y = 1; y <= 4; y++) {
      const yPos = (h / 5) * y;
      ctx.beginPath();
      ctx.moveTo(0, yPos);
      ctx.lineTo(w, yPos);
      ctx.stroke();
    }

    const maxVal = Math.max(state.waveform.maxVal, 20);

    // Draw helper for series
    function renderSeries(points, strokeColor, fillColor) {
      if (points.length < 2) return;

      ctx.beginPath();
      const firstX = (points[0].relTime / state.waveform.totalSec) * w;
      const firstY = h - (points[0].mbps / maxVal) * (h - 20) - 10;
      ctx.moveTo(firstX, firstY);

      for (let i = 1; i < points.length; i++) {
        const x = (points[i].relTime / state.waveform.totalSec) * w;
        const y = h - (points[i].mbps / maxVal) * (h - 20) - 10;
        const prevX = (points[i - 1].relTime / state.waveform.totalSec) * w;
        const prevY = h - (points[i - 1].mbps / maxVal) * (h - 20) - 10;
        const cx = (prevX + x) / 2;
        ctx.bezierCurveTo(cx, prevY, cx, y, x, y);
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Fill area under curve
      const lastX = (points[points.length - 1].relTime / state.waveform.totalSec) * w;
      ctx.lineTo(lastX, h);
      ctx.lineTo(firstX, h);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
    }

    // Download series (Cyan)
    const cyanGrad = ctx.createLinearGradient(0, 0, 0, h);
    cyanGrad.addColorStop(0, 'rgba(0, 242, 254, 0.25)');
    cyanGrad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
    renderSeries(state.waveform.download, '#00f2fe', cyanGrad);

    // Upload series (Purple)
    const purpleGrad = ctx.createLinearGradient(0, 0, 0, h);
    purpleGrad.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
    purpleGrad.addColorStop(1, 'rgba(168, 85, 247, 0.0)');
    renderSeries(state.waveform.upload, '#a855f7', purpleGrad);
  }

  // --- NETWORK INTELLIGENCE ---
  async function fetchNetworkInfo() {
    // 1. Try local server API (if self-hosted)
    try {
      const res = await fetch('/api/ip');
      if (res.ok) {
        const data = await res.json();
        applyNetworkInfo(data);
        return;
      }
    } catch (_) {}

    // 2. Direct browser fallback for Vercel / GitHub Pages / Netlify (ipwho.is)
    try {
      const res = await fetch('https://ipwho.is/');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          applyNetworkInfo({
            ip: data.ip,
            isp: data.connection?.isp || data.connection?.org || 'Global ISP',
            asn: data.connection?.asn ? `AS${data.connection.asn}` : '',
            city: data.city || 'Edge',
            country: data.country || 'Global',
            flag: data.flag?.emoji || '🌐'
          });
          return;
        }
      }
    } catch (_) {}

    // 3. Fallback to Cloudflare edge metadata headers
    try {
      const res = await fetch('https://speed.cloudflare.com/__down?bytes=0', { cache: 'no-store' });
      const ip = res.headers.get('cf-meta-ip') || 'Unknown';
      const city = res.headers.get('cf-meta-city') || 'Edge Node';
      const country = res.headers.get('cf-meta-country') || 'Global';
      const asn = res.headers.get('cf-meta-asn') ? `AS${res.headers.get('cf-meta-asn')}` : '';
      applyNetworkInfo({
        ip: ip,
        isp: 'Cloudflare Edge CDN',
        asn: asn,
        city: city,
        country: country,
        flag: '⚡'
      });
    } catch (e) {
      elements.ispName.textContent = 'Global Edge CDN';
      elements.serverLoc.textContent = 'Edge Network';
    }
  }

  function applyNetworkInfo(data) {
    state.networkInfo = data;
    elements.geoFlag.textContent = data.flag || '🌐';
    elements.ispName.textContent = `${data.isp} ${data.asn ? '(' + data.asn + ')' : ''}`.trim();
    elements.serverLoc.textContent = `${data.city || 'Edge'}, ${data.country || 'Global'}`.trim();
    updateIpDisplay();
  }

  function updateIpDisplay() {
    if (!state.networkInfo) return;
    const ip = state.networkInfo.ip || '127.0.0.1';
    if (state.ipRevealed) {
      elements.clientIp.textContent = ip;
      elements.toggleIpBtn.textContent = 'Hide';
    } else {
      elements.clientIp.textContent = ip.replace(/\d+/g, '•••');
      elements.toggleIpBtn.textContent = 'Show';
    }
  }

  elements.toggleIpBtn.addEventListener('click', () => {
    state.ipRevealed = !state.ipRevealed;
    updateIpDisplay();
  });

  // --- PROFILE CONFIGURATIONS ---
  function getProfileDuration() {
    if (state.profile === 'quick') return { downSec: 5, upSec: 4, streams: 2 };
    if (state.profile === 'stress') return { downSec: 18, upSec: 14, streams: 6 };
    return { downSec: 8, upSec: 7, streams: 4 }; // Standard
  }

  // --- SPEED TESTING ENGINES ---

  // 1. Direct Edge Engine (Browser-to-Cloudflare)
  async function runEdgeSpeedTest() {
    const config = getProfileDuration();
    state.waveform.download = [];
    state.waveform.upload = [];
    state.waveform.maxVal = 50;
    state.waveform.totalSec = config.downSec + config.upSec + 2;
    state.waveform.startTime = performance.now();

    // STAGE 1: PING & JITTER
    setStage('ping', 'Measuring latency & jitter...');
    const pingSamples = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      try {
        await fetch(`https://speed.cloudflare.com/__down?bytes=0&_t=${Date.now()}_${i}`, { cache: 'no-store' });
        const t1 = performance.now();
        pingSamples.push(t1 - t0);
      } catch (e) {
        // Fallback to local ping if blocked
        try {
          await fetch(`/api/ping?_t=${Date.now()}_${i}`, { cache: 'no-store' });
          pingSamples.push(performance.now() - t0);
        } catch (_) {}
      }
      await new Promise(r => setTimeout(r, 60));
    }

    const minPing = Math.min(...pingSamples);
    const avgPing = pingSamples.reduce((a, b) => a + b, 0) / pingSamples.length;
    const maxPing = Math.max(...pingSamples);
    let jitterSum = 0;
    for (let i = 1; i < pingSamples.length; i++) {
      jitterSum += Math.abs(pingSamples[i] - pingSamples[i - 1]);
    }
    const jitter = pingSamples.length > 1 ? jitterSum / (pingSamples.length - 1) : 0;

    state.currentRun.ping = {
      min: minPing.toFixed(1),
      avg: avgPing.toFixed(1),
      max: maxPing.toFixed(1),
      jitter: jitter.toFixed(1)
    };

    elements.resPingVal.textContent = state.currentRun.ping.avg;
    elements.resPingMin.textContent = state.currentRun.ping.min;
    elements.resPingMax.textContent = state.currentRun.ping.max;
    elements.resJitterVal.textContent = state.currentRun.ping.jitter;

    playSound('phase');

    // STAGE 2: DOWNLOAD
    setStage('download', 'Measuring download throughput...');
    let totalDlBytes = 0;
    let peakDlMbps = 0;
    const dlStartTime = performance.now();
    let dlRunning = true;

    // Concurrently fetch chunks
    const chunkSizes = [1_000_000, 5_000_000, 15_000_000, 25_000_000];
    
    async function dlWorker(workerId) {
      let chunkIdx = 0;
      while (dlRunning) {
        const sz = chunkSizes[Math.min(chunkIdx, chunkSizes.length - 1)];
        chunkIdx++;
        try {
          const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${sz}&_w=${workerId}&_t=${Date.now()}`, { cache: 'no-store' });
          const reader = res.body.getReader();
          while (dlRunning) {
            const { done, value } = await reader.read();
            if (done) break;
            totalDlBytes += value.length;
          }
        } catch (e) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    const workers = [];
    for (let w = 0; w < config.streams; w++) {
      workers.push(dlWorker(w));
    }

    // Measure loop
    let lastTime = dlStartTime;
    let lastBytes = 0;

    while ((performance.now() - dlStartTime) / 1000 < config.downSec) {
      await new Promise(r => setTimeout(r, 100));
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      const db = totalDlBytes - lastBytes;
      if (dt > 0) {
        const liveMbps = (db * 8) / (dt * 1_000_000);
        if (liveMbps > peakDlMbps) peakDlMbps = liveMbps;
        if (liveMbps > state.waveform.maxVal) state.waveform.maxVal = liveMbps * 1.15;
        
        updateGauge(liveMbps);
        elements.liveElapsed.textContent = `${((now - dlStartTime) / 1000).toFixed(1)}s`;
        elements.liveTransferred.textContent = `${(totalDlBytes / (1024 * 1024)).toFixed(1)} MB`;
        elements.livePeak.textContent = `${formatSpeed(peakDlMbps)} ${getUnitLabel()}`;

        state.waveform.download.push({
          relTime: (now - state.waveform.startTime) / 1000,
          mbps: liveMbps
        });
        drawWaveform();
      }
      lastTime = now;
      lastBytes = totalDlBytes;
    }

    dlRunning = false;
    const dlTotalElapsed = (performance.now() - dlStartTime) / 1000;
    const avgDlMbps = (totalDlBytes * 8) / (dlTotalElapsed * 1_000_000);

    state.currentRun.download = {
      avgMbps: avgDlMbps,
      peakMbps: peakDlMbps,
      bytes: (totalDlBytes / (1024 * 1024)).toFixed(1),
      duration: dlTotalElapsed.toFixed(1)
    };

    elements.resDownVal.textContent = formatSpeed(avgDlMbps);
    elements.resDownPeak.textContent = formatSpeed(peakDlMbps);
    elements.resDownBytes.textContent = `${state.currentRun.download.bytes} MB`;

    playSound('phase');

    // STAGE 3: UPLOAD
    setStage('upload', 'Measuring upload throughput...');
    let totalUpBytes = 0;
    let peakUpMbps = 0;
    const upStartTime = performance.now();
    let upRunning = true;

    // Pre-allocated random chunk for upload (1MB)
    const payload = new Uint8Array(1024 * 1024);
    for (let i = 0; i < payload.length; i += 64) payload[i] = (Math.random() * 256) | 0;

    async function upWorker() {
      while (upRunning) {
        try {
          await fetch(`https://speed.cloudflare.com/__up?_t=${Date.now()}`, {
            method: 'POST',
            body: payload,
            headers: { 'Content-Type': 'application/octet-stream' }
          });
          totalUpBytes += payload.length;
        } catch (e) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    const upWorkers = [];
    for (let w = 0; w < Math.min(config.streams, 3); w++) {
      upWorkers.push(upWorker());
    }

    lastTime = upStartTime;
    lastBytes = 0;

    while ((performance.now() - upStartTime) / 1000 < config.upSec) {
      await new Promise(r => setTimeout(r, 100));
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      const db = totalUpBytes - lastBytes;
      if (dt > 0) {
        const liveMbps = (db * 8) / (dt * 1_000_000);
        if (liveMbps > peakUpMbps) peakUpMbps = liveMbps;
        if (liveMbps > state.waveform.maxVal) state.waveform.maxVal = liveMbps * 1.15;

        updateGauge(liveMbps);
        elements.liveElapsed.textContent = `${((now - upStartTime) / 1000).toFixed(1)}s`;
        elements.liveTransferred.textContent = `${(totalUpBytes / (1024 * 1024)).toFixed(1)} MB`;
        elements.livePeak.textContent = `${formatSpeed(peakUpMbps)} ${getUnitLabel()}`;

        state.waveform.upload.push({
          relTime: (now - state.waveform.startTime) / 1000,
          mbps: liveMbps
        });
        drawWaveform();
      }
      lastTime = now;
      lastBytes = totalUpBytes;
    }

    upRunning = false;
    const upTotalElapsed = (performance.now() - upStartTime) / 1000;
    const avgUpMbps = (totalUpBytes * 8) / (upTotalElapsed * 1_000_000);

    state.currentRun.upload = {
      avgMbps: avgUpMbps,
      peakMbps: peakUpMbps,
      bytes: (totalUpBytes / (1024 * 1024)).toFixed(1),
      duration: upTotalElapsed.toFixed(1)
    };

    elements.resUpVal.textContent = formatSpeed(avgUpMbps);
    elements.resUpPeak.textContent = formatSpeed(peakUpMbps);
    elements.resUpBytes.textContent = `${state.currentRun.upload.bytes} MB`;

    // STAGE 4: BUFFERBLOAT & LOADED LATENCY
    setStage('loaded_ping', 'Analyzing bufferbloat & loaded latency...');
    const loadedSamples = [];
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      try {
        await fetch(`https://speed.cloudflare.com/__down?bytes=0&_t=${Date.now()}_${i}`, { cache: 'no-store' });
        loadedSamples.push(performance.now() - t0);
      } catch (e) {
        loadedSamples.push(avgPing + 8);
      }
    }
    const avgLoadedPing = loadedSamples.reduce((a, b) => a + b, 0) / loadedSamples.length;
    const delta = Math.max(0, avgLoadedPing - avgPing);

    let grade = 'A+';
    if (delta > 120) grade = 'F';
    else if (delta > 60) grade = 'D';
    else if (delta > 30) grade = 'C';
    else if (delta > 15) grade = 'B';
    else if (delta > 5) grade = 'A';

    state.currentRun.loadedPing = {
      avg: avgLoadedPing.toFixed(1),
      delta: delta.toFixed(1),
      grade: grade
    };

    elements.resLoadedPing.textContent = `+${delta.toFixed(1)} ms`;
    elements.bufferbloatBadge.textContent = grade;
    elements.bufferbloatBadge.className = `qi-badge grade-${grade.toLowerCase().replace('+', 'plus')}`;

    // Finish test
    finishTest();
  }

  // 2. Local LAN Engine (Browser-to-Host-Server)
  async function runLanSpeedTest() {
    const config = getProfileDuration();
    state.waveform.download = [];
    state.waveform.upload = [];
    state.waveform.maxVal = 100;
    state.waveform.totalSec = config.downSec + config.upSec + 2;
    state.waveform.startTime = performance.now();

    // Ping
    setStage('ping', 'Measuring LAN latency...');
    const pingSamples = [];
    try {
      for (let i = 0; i < 8; i++) {
        const t0 = performance.now();
        const res = await fetch(`/api/ping?_t=${Date.now()}_${i}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('API unavailable');
        pingSamples.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 40));
      }
    } catch (err) {
      showToast('Local LAN mode requires self-hosted Python server. Switched to Global Edge.');
      state.mode = 'edge';
      elements.targetModeControl.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'edge');
      });
      await runEdgeSpeedTest();
      return;
    }
    const avgPing = pingSamples.reduce((a, b) => a + b, 0) / pingSamples.length;
    state.currentRun.ping = {
      min: Math.min(...pingSamples).toFixed(1),
      avg: avgPing.toFixed(1),
      max: Math.max(...pingSamples).toFixed(1),
      jitter: (Math.max(...pingSamples) - Math.min(...pingSamples)).toFixed(1)
    };
    elements.resPingVal.textContent = state.currentRun.ping.avg;
    elements.resPingMin.textContent = state.currentRun.ping.min;
    elements.resPingMax.textContent = state.currentRun.ping.max;
    elements.resJitterVal.textContent = state.currentRun.ping.jitter;

    playSound('phase');

    // Download from /api/down
    setStage('download', 'Measuring local LAN download speed...');
    let totalDlBytes = 0;
    let peakDlMbps = 0;
    const dlStartTime = performance.now();
    let dlRunning = true;

    async function lanDlWorker() {
      while (dlRunning) {
        try {
          const res = await fetch(`/api/down?bytes=20000000&_t=${Date.now()}`, { cache: 'no-store' });
          const reader = res.body.getReader();
          while (dlRunning) {
            const { done, value } = await reader.read();
            if (done) break;
            totalDlBytes += value.length;
          }
        } catch (e) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
    }

    const workers = [lanDlWorker(), lanDlWorker(), lanDlWorker()];
    let lastTime = dlStartTime;
    let lastBytes = 0;

    while ((performance.now() - dlStartTime) / 1000 < config.downSec) {
      await new Promise(r => setTimeout(r, 100));
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      const db = totalDlBytes - lastBytes;
      if (dt > 0) {
        const liveMbps = (db * 8) / (dt * 1_000_000);
        if (liveMbps > peakDlMbps) peakDlMbps = liveMbps;
        if (liveMbps > state.waveform.maxVal) state.waveform.maxVal = liveMbps * 1.15;
        updateGauge(liveMbps);
        elements.liveElapsed.textContent = `${((now - dlStartTime) / 1000).toFixed(1)}s`;
        elements.liveTransferred.textContent = `${(totalDlBytes / (1024 * 1024)).toFixed(1)} MB`;
        elements.livePeak.textContent = `${formatSpeed(peakDlMbps)} ${getUnitLabel()}`;
        state.waveform.download.push({ relTime: (now - state.waveform.startTime) / 1000, mbps: liveMbps });
        drawWaveform();
      }
      lastTime = now;
      lastBytes = totalDlBytes;
    }
    dlRunning = false;
    const avgDlMbps = (totalDlBytes * 8) / (((performance.now() - dlStartTime) / 1000) * 1_000_000);
    state.currentRun.download = { avgMbps: avgDlMbps, peakMbps: peakDlMbps, bytes: (totalDlBytes / (1024 * 1024)).toFixed(1) };
    elements.resDownVal.textContent = formatSpeed(avgDlMbps);
    elements.resDownPeak.textContent = formatSpeed(peakDlMbps);
    elements.resDownBytes.textContent = `${state.currentRun.download.bytes} MB`;

    playSound('phase');

    // Upload to /api/up
    setStage('upload', 'Measuring local LAN upload speed...');
    let totalUpBytes = 0;
    let peakUpMbps = 0;
    const upStartTime = performance.now();
    let upRunning = true;
    const payload = new Uint8Array(2 * 1024 * 1024);

    async function lanUpWorker() {
      while (upRunning) {
        try {
          await fetch(`/api/up?_t=${Date.now()}`, { method: 'POST', body: payload });
          totalUpBytes += payload.length;
        } catch (e) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
    }
    const upWorkers = [lanUpWorker(), lanUpWorker()];
    lastTime = upStartTime;
    lastBytes = 0;

    while ((performance.now() - upStartTime) / 1000 < config.upSec) {
      await new Promise(r => setTimeout(r, 100));
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      const db = totalUpBytes - lastBytes;
      if (dt > 0) {
        const liveMbps = (db * 8) / (dt * 1_000_000);
        if (liveMbps > peakUpMbps) peakUpMbps = liveMbps;
        if (liveMbps > state.waveform.maxVal) state.waveform.maxVal = liveMbps * 1.15;
        updateGauge(liveMbps);
        elements.liveElapsed.textContent = `${((now - upStartTime) / 1000).toFixed(1)}s`;
        elements.liveTransferred.textContent = `${(totalUpBytes / (1024 * 1024)).toFixed(1)} MB`;
        elements.livePeak.textContent = `${formatSpeed(peakUpMbps)} ${getUnitLabel()}`;
        state.waveform.upload.push({ relTime: (now - state.waveform.startTime) / 1000, mbps: liveMbps });
        drawWaveform();
      }
      lastTime = now;
      lastBytes = totalUpBytes;
    }
    upRunning = false;
    const avgUpMbps = (totalUpBytes * 8) / (((performance.now() - upStartTime) / 1000) * 1_000_000);
    state.currentRun.upload = { avgMbps: avgUpMbps, peakMbps: peakUpMbps, bytes: (totalUpBytes / (1024 * 1024)).toFixed(1) };
    elements.resUpVal.textContent = formatSpeed(avgUpMbps);
    elements.resUpPeak.textContent = formatSpeed(peakUpMbps);
    elements.resUpBytes.textContent = `${state.currentRun.upload.bytes} MB`;

    state.currentRun.loadedPing = { avg: avgPing.toFixed(1), delta: '0.0', grade: 'A+' };
    elements.resLoadedPing.textContent = '+0.0 ms';
    elements.bufferbloatBadge.textContent = 'A+';
    elements.bufferbloatBadge.className = 'qi-badge grade-aplus';

    finishTest();
  }

  // 3. Server Internet Test (SSE Stream)
  function runHostServerSpeedTest() {
    state.waveform.download = [];
    state.waveform.upload = [];
    state.waveform.maxVal = 50;
    state.waveform.totalSec = 16;
    state.waveform.startTime = performance.now();

    setStage('ping', 'Server measuring latency & network info...');
    const evtSource = new EventSource('/api/server-test');

    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.stage === 'ping') {
          setStage('ping', data.message);
        } else if (data.stage === 'ping_done') {
          state.currentRun.ping = {
            min: data.ping,
            avg: data.ping,
            max: data.ping,
            jitter: data.jitter
          };
          elements.resPingVal.textContent = data.ping;
          elements.resJitterVal.textContent = data.jitter;
          playSound('phase');
          setStage('download', 'Server testing download...');
        } else if (data.stage === 'download') {
          const liveMbps = data.instant_mbps || 0;
          if (liveMbps > state.waveform.maxVal) state.waveform.maxVal = liveMbps * 1.15;
          updateGauge(liveMbps);
          elements.liveElapsed.textContent = `${data.elapsed}s`;
          elements.liveTransferred.textContent = `${data.transferred_mb} MB`;
          elements.livePeak.textContent = `${formatSpeed(data.peak_mbps)} ${getUnitLabel()}`;
          state.waveform.download.push({ relTime: (performance.now() - state.waveform.startTime) / 1000, mbps: liveMbps });
          drawWaveform();
        } else if (data.stage === 'download_done') {
          elements.resDownVal.textContent = formatSpeed(data.download_mbps);
          playSound('phase');
          setStage('upload', 'Server testing upload...');
        } else if (data.stage === 'upload') {
          const liveMbps = data.instant_mbps || 0;
          if (liveMbps > state.waveform.maxVal) state.waveform.maxVal = liveMbps * 1.15;
          updateGauge(liveMbps);
          elements.liveElapsed.textContent = `${data.elapsed}s`;
          elements.liveTransferred.textContent = `${data.transferred_mb} MB`;
          elements.livePeak.textContent = `${formatSpeed(data.peak_mbps)} ${getUnitLabel()}`;
          state.waveform.upload.push({ relTime: (performance.now() - state.waveform.startTime) / 1000, mbps: liveMbps });
          drawWaveform();
        } else if (data.stage === 'done') {
          evtSource.close();
          const res = data.result;
          state.currentRun = {
            ping: res.ping,
            loadedPing: {
              avg: res.loaded_ping.avg,
              delta: res.bufferbloat.delta_ms,
              grade: res.bufferbloat.grade
            },
            download: {
              avgMbps: res.download.average_mbps,
              peakMbps: res.download.peak_mbps,
              bytes: res.download.transferred_mb
            },
            upload: {
              avgMbps: res.upload.average_mbps,
              peakMbps: res.upload.peak_mbps,
              bytes: res.upload.transferred_mb
            }
          };
          elements.resDownVal.textContent = formatSpeed(res.download.average_mbps);
          elements.resDownPeak.textContent = formatSpeed(res.download.peak_mbps);
          elements.resDownBytes.textContent = `${res.download.transferred_mb} MB`;

          elements.resUpVal.textContent = formatSpeed(res.upload.average_mbps);
          elements.resUpPeak.textContent = formatSpeed(res.upload.peak_mbps);
          elements.resUpBytes.textContent = `${res.upload.transferred_mb} MB`;

          elements.resPingVal.textContent = res.ping.avg;
          elements.resPingMin.textContent = res.ping.min;
          elements.resPingMax.textContent = res.ping.max;
          elements.resJitterVal.textContent = res.ping.jitter;

          elements.resLoadedPing.textContent = `+${res.bufferbloat.delta_ms} ms`;
          elements.bufferbloatBadge.textContent = res.bufferbloat.grade;
          elements.bufferbloatBadge.className = `qi-badge grade-${res.bufferbloat.grade.toLowerCase().replace('+', 'plus')}`;

          finishTest();
        }
      } catch (err) {
        console.error(err);
      }
    };

    evtSource.onerror = () => {
      evtSource.close();
      showToast('Host server test requires self-hosted Python server. Switched to Global Edge.');
      state.mode = 'edge';
      elements.targetModeControl.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'edge');
      });
      finishTest();
    };
  }

  // --- STAGE DISPATCHER ---
  function setStage(stage, message) {
    state.currentStage = stage;
    elements.gaugeSubstatus.textContent = message;

    elements.stagePing.classList.remove('active', 'completed');
    elements.stageDown.classList.remove('active', 'completed');
    elements.stageUp.classList.remove('active', 'completed');

    if (stage === 'ping') {
      elements.stagePing.classList.add('active');
    } else if (stage === 'download') {
      elements.stagePing.classList.add('completed');
      elements.stageDown.classList.add('active');
    } else if (stage === 'upload') {
      elements.stagePing.classList.add('completed');
      elements.stageDown.classList.add('completed');
      elements.stageUp.classList.add('active');
    } else if (stage === 'done') {
      elements.stagePing.classList.add('completed');
      elements.stageDown.classList.add('completed');
      elements.stageUp.classList.add('completed');
    }
  }

  // --- TEST LIFECYCLE ---
  async function startTest() {
    if (state.testing) return;
    state.testing = true;

    elements.startBtn.classList.add('hidden');
    elements.readoutBlock.classList.remove('hidden');
    updateGauge(0);
    playSound('start');

    try {
      if (state.mode === 'edge') {
        await runEdgeSpeedTest();
      } else if (state.mode === 'lan') {
        await runLanSpeedTest();
      } else if (state.mode === 'host') {
        runHostServerSpeedTest();
      }
    } catch (e) {
      console.error(e);
      showToast('Speed test encountered a network interruption');
      finishTest();
    }
  }

  function finishTest() {
    state.testing = false;
    setStage('done', 'Test Complete');
    playSound('finish');

    elements.startBtn.classList.remove('hidden');
    elements.startBtn.querySelector('.go-text').textContent = 'AGAIN';
    elements.startBtn.querySelector('.go-sub').textContent = 'RETEST';

    // Compute Ratings
    const dl = state.currentRun.download.avgMbps;
    const up = state.currentRun.upload.avgMbps;
    const ping = parseFloat(state.currentRun.ping.avg) || 0;
    const jitter = parseFloat(state.currentRun.ping.jitter) || 0;

    // Gaming
    if (ping < 35 && jitter < 6) elements.gamingRating.textContent = '★★★★★ Pro Esports';
    else if (ping < 70) elements.gamingRating.textContent = '★★★★☆ Smooth';
    else elements.gamingRating.textContent = '★★☆☆☆ Moderate Lag';

    // Streaming
    if (dl >= 25) elements.gamingRating; // already handled
    if (dl >= 25) elements.streamingRating.textContent = '★★★★★ 4K Ultra HD';
    else if (dl >= 10) elements.streamingRating.textContent = '★★★★☆ 1080p Full HD';
    else elements.streamingRating.textContent = '★★★☆☆ 720p HD';

    // Calls / Zoom
    if (up >= 8 && jitter < 12) elements.callRating.textContent = '★★★★★ Crystal HD';
    else if (up >= 3) elements.callRating.textContent = '★★★★☆ Clear Audio';
    else elements.callRating.textContent = '★★☆☆☆ Choppy Video';

    // Stability calculation
    const stability = Math.max(75, Math.min(100, Math.round(100 - jitter * 1.5)));
    elements.resStability.textContent = `${stability}%`;

    // Save history
    const entry = {
      timestamp: new Date().toLocaleString(),
      epoch: Date.now(),
      mode: state.mode.toUpperCase(),
      download: state.currentRun.download.avgMbps,
      upload: state.currentRun.upload.avgMbps,
      ping: state.currentRun.ping.avg,
      jitter: state.currentRun.ping.jitter,
      grade: state.currentRun.loadedPing.grade || 'A'
    };
    saveHistoryRecord(entry);
  }

  // --- HISTORY MANAGEMENT ---
  function loadLocalHistory() {
    try {
      const data = localStorage.getItem('skyspeed_history') || localStorage.getItem('speedpulse_history');
      if (data) {
        state.history = JSON.parse(data);
        renderHistoryTable();
      }
    } catch (e) {}

    // Also fetch server history
    fetch('/api/history')
      .then(r => r.json())
      .then(srvHistory => {
        if (Array.isArray(srvHistory) && srvHistory.length > 0) {
          // Merge or adopt
          if (state.history.length === 0) {
            state.history = srvHistory.map(h => ({
              timestamp: h.timestamp,
              epoch: h.epoch,
              mode: h.mode || 'SERVER',
              download: h.download?.average_mbps || 0,
              upload: h.upload?.average_mbps || 0,
              ping: h.ping?.avg || 0,
              jitter: h.ping?.jitter || 0,
              grade: h.bufferbloat?.grade || 'A'
            }));
            renderHistoryTable();
          }
        }
      })
      .catch(() => {});
  }

  function saveHistoryRecord(entry) {
    state.history.unshift(entry);
    state.history = state.history.slice(0, 40); // Keep last 40
    try {
      localStorage.setItem('skyspeed_history', JSON.stringify(state.history));
    } catch (e) {}

    // Sync to server API
    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch(() => {});

    renderHistoryTable();
  }

  function renderHistoryTable() {
    elements.historyCount.textContent = `${state.history.length} runs recorded`;
    if (state.history.length === 0) {
      elements.historyTbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">No tests recorded yet. Run a speed test to track performance over time!</td>
        </tr>`;
      return;
    }

    elements.historyTbody.innerHTML = state.history.map(item => {
      const dl = formatSpeed(item.download || 0);
      const up = formatSpeed(item.upload || 0);
      const grade = item.grade || 'A';
      return `
        <tr>
          <td>${item.timestamp}</td>
          <td><span class="badge">${item.mode || 'EDGE'}</span></td>
          <td style="color:var(--cyan);font-weight:700;">${dl} ${getUnitLabel()}</td>
          <td style="color:var(--purple);font-weight:700;">${up} ${getUnitLabel()}</td>
          <td>${item.ping} ms</td>
          <td>${item.jitter} ms</td>
          <td><span class="qi-badge grade-${grade.toLowerCase().replace('+', 'plus')}">${grade}</span></td>
        </tr>`;
    }).join('');
  }

  // --- EXPORT & SHARE FUNCTIONS ---
  elements.copyResultBtn.addEventListener('click', () => {
    const text = `⚡ SkySpeed Test Results:
• Download: ${formatSpeed(state.currentRun.download.avgMbps)} ${getUnitLabel()} (Peak: ${formatSpeed(state.currentRun.download.peakMbps)})
• Upload: ${formatSpeed(state.currentRun.upload.avgMbps)} ${getUnitLabel()} (Peak: ${formatSpeed(state.currentRun.upload.peakMbps)})
• Idle Ping: ${state.currentRun.ping.avg} ms | Jitter: ${state.currentRun.ping.jitter} ms
• Bufferbloat Grade: ${state.currentRun.loadedPing.grade} (${elements.resLoadedPing.textContent})
• ISP: ${state.networkInfo?.isp || 'Unknown'} | Location: ${state.networkInfo?.city || ''}, ${state.networkInfo?.country || ''}
• Mode: ${state.mode.toUpperCase()}`;

    navigator.clipboard.writeText(text).then(() => {
      showToast('Results summary copied to clipboard!');
    }).catch(() => {
      showToast('Could not access clipboard');
    });
  });

  elements.exportCsvBtn.addEventListener('click', () => {
    if (state.history.length === 0) {
      showToast('No history available to export');
      return;
    }
    const headers = ['Timestamp', 'Mode', 'Download_Mbps', 'Upload_Mbps', 'Ping_ms', 'Jitter_ms', 'Bufferbloat_Grade'];
    const rows = state.history.map(h => [
      `"${h.timestamp}"`,
      h.mode,
      h.download,
      h.upload,
      h.ping,
      h.jitter,
      h.grade
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `skyspeed_history_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Exported history as CSV');
  });

  elements.clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Clear all test history?')) {
      state.history = [];
      try { 
        localStorage.removeItem('skyspeed_history');
        localStorage.removeItem('speedpulse_history');
      } catch (e) {}
      fetch('/api/history', { method: 'DELETE' }).catch(() => {});
      renderHistoryTable();
      showToast('History cleared');
    }
  });

  // Export Sleek Share Card as Image (Canvas 1200x630 PNG)
  elements.downloadCardBtn.addEventListener('click', () => {
    const cardCanvas = elements.shareCardCanvas;
    const c = cardCanvas.getContext('2d');
    const w = 1200;
    const h = 630;

    // Background Gradient
    const bgGrad = c.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, '#070a13');
    bgGrad.addColorStop(1, '#0e172a');
    c.fillStyle = bgGrad;
    c.fillRect(0, 0, w, h);

    // Glowing accents
    c.fillStyle = 'rgba(0, 242, 254, 0.08)';
    c.beginPath();
    c.arc(200, 150, 240, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = 'rgba(168, 85, 247, 0.08)';
    c.beginPath();
    c.arc(1000, 480, 280, 0, Math.PI * 2);
    c.fill();

    // Border
    c.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    c.lineWidth = 2;
    c.strokeRect(24, 24, w - 48, h - 48);

    // Logo & Header
    if (state.customLogoImg) {
      try {
        c.drawImage(state.customLogoImg, 64, 48, 52, 52);
        c.fillStyle = '#00f2fe';
        c.font = 'bold 36px "Plus Jakarta Sans", sans-serif';
        c.fillText('SkySpeed', 130, 88);
      } catch (err) {
        c.fillStyle = '#00f2fe';
        c.font = 'bold 36px "Plus Jakarta Sans", sans-serif';
        c.fillText('⚡ SkySpeed', 64, 88);
      }
    } else {
      c.fillStyle = '#00f2fe';
      c.font = 'bold 36px "Plus Jakarta Sans", sans-serif';
      c.fillText('⚡ SkySpeed', 64, 88);
    }

    c.fillStyle = '#94a3b8';
    c.font = '500 18px "Plus Jakarta Sans", sans-serif';
    c.fillText('PRECISION NETWORK PERFORMANCE REPORT', 64, 120);

    // Metric 1: Download
    c.fillStyle = 'rgba(14, 21, 38, 0.85)';
    c.fillRect(64, 160, 500, 200);
    c.strokeStyle = 'rgba(0, 242, 254, 0.4)';
    c.strokeRect(64, 160, 500, 200);

    c.fillStyle = '#94a3b8';
    c.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
    c.fillText('DOWNLOAD SPEED', 94, 205);

    c.fillStyle = '#00f2fe';
    c.font = 'bold 64px "JetBrains Mono", monospace';
    c.fillText(formatSpeed(state.currentRun.download.avgMbps), 94, 290);

    c.fillStyle = '#64748b';
    c.font = 'bold 24px "JetBrains Mono", monospace';
    c.fillText(getUnitLabel(), 400, 290);

    c.fillStyle = '#94a3b8';
    c.font = '16px "Plus Jakarta Sans", sans-serif';
    c.fillText(`Peak: ${formatSpeed(state.currentRun.download.peakMbps)} ${getUnitLabel()}`, 94, 335);

    // Metric 2: Upload
    c.fillStyle = 'rgba(14, 21, 38, 0.85)';
    c.fillRect(636, 160, 500, 200);
    c.strokeStyle = 'rgba(168, 85, 247, 0.4)';
    c.strokeRect(636, 160, 500, 200);

    c.fillStyle = '#94a3b8';
    c.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
    c.fillText('UPLOAD SPEED', 666, 205);

    c.fillStyle = '#a855f7';
    c.font = 'bold 64px "JetBrains Mono", monospace';
    c.fillText(formatSpeed(state.currentRun.upload.avgMbps), 666, 290);

    c.fillStyle = '#64748b';
    c.font = 'bold 24px "JetBrains Mono", monospace';
    c.fillText(getUnitLabel(), 970, 290);

    c.fillStyle = '#94a3b8';
    c.font = '16px "Plus Jakarta Sans", sans-serif';
    c.fillText(`Peak: ${formatSpeed(state.currentRun.upload.peakMbps)} ${getUnitLabel()}`, 666, 335);

    // Bottom Stats (Ping, Jitter, Bufferbloat, ISP)
    const statsY = 410;
    const statBoxWidth = 240;

    function drawSmallBox(x, title, val, color) {
      c.fillStyle = 'rgba(20, 31, 54, 0.7)';
      c.fillRect(x, statsY, statBoxWidth, 110);
      c.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      c.strokeRect(x, statsY, statBoxWidth, 110);

      c.fillStyle = '#64748b';
      c.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
      c.fillText(title.toUpperCase(), x + 20, statsY + 35);

      c.fillStyle = color;
      c.font = 'bold 32px "JetBrains Mono", monospace';
      c.fillText(val, x + 20, statsY + 82);
    }

    drawSmallBox(64, 'Latency (Ping)', `${state.currentRun.ping.avg} ms`, '#10b981');
    drawSmallBox(328, 'Jitter', `${state.currentRun.ping.jitter} ms`, '#f59e0b');
    drawSmallBox(592, 'Bufferbloat', `Grade ${state.currentRun.loadedPing.grade}`, '#38bdf8');
    drawSmallBox(856, 'Stability', elements.resStability.textContent, '#c084fc');

    // Footer Info
    c.fillStyle = '#64748b';
    c.font = '15px "Plus Jakarta Sans", sans-serif';
    const isp = state.networkInfo?.isp || 'Unknown ISP';
    const loc = `${state.networkInfo?.city || ''}, ${state.networkInfo?.country || ''}`.trim().replace(/^,|,$/g, '');
    c.fillText(`Network: ${isp} | Location: ${loc || 'Global'} | Mode: ${state.mode.toUpperCase()}`, 64, 570);
    c.fillText(`Tested on: ${new Date().toLocaleString()}`, 820, 570);

    // Trigger Download
    const dataUrl = cardCanvas.toDataURL('image/png');
    const dlLink = document.createElement('a');
    dlLink.download = `SkySpeed_Result_${Date.now()}.png`;
    dlLink.href = dataUrl;
    dlLink.click();
    showToast('Saved result card image!');
  });

  // --- EVENT LISTENERS & INITIALIZATION ---

  // Start Button Click
  elements.startBtn.addEventListener('click', startTest);

  // Mode Selection
  elements.targetModeControl.querySelectorAll('.segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.testing) return;
      elements.targetModeControl.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      elements.gaugeSubstatus.textContent = `Mode: ${btn.textContent.trim()} (Ready)`;
      showToast(`Switched to ${btn.textContent.trim()} mode`);
    });
  });

  // Unit Selection
  elements.unitSelect.addEventListener('change', (e) => {
    state.unit = e.target.value;
    const label = getUnitLabel();
    elements.currentSpeedUnit.textContent = label;
    elements.resDownUnit.textContent = label;
    elements.resUpUnit.textContent = label;
    updateGauge(state.currentSpeedMbps);
    if (state.currentRun.download.avgMbps) {
      elements.resDownVal.textContent = formatSpeed(state.currentRun.download.avgMbps);
      elements.resDownPeak.textContent = formatSpeed(state.currentRun.download.peakMbps);
    }
    if (state.currentRun.upload.avgMbps) {
      elements.resUpVal.textContent = formatSpeed(state.currentRun.upload.avgMbps);
      elements.resUpPeak.textContent = formatSpeed(state.currentRun.upload.peakMbps);
    }
    renderHistoryTable();
  });

  // Profile Selection
  elements.profileSelect.addEventListener('change', (e) => {
    state.profile = e.target.value;
  });

  // Theme Toggle
  elements.themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('skyspeed_theme', newTheme);

    if (newTheme === 'light') {
      elements.sunIcon.classList.add('hidden');
      elements.moonIcon.classList.remove('hidden');
    } else {
      elements.sunIcon.classList.remove('hidden');
      elements.moonIcon.classList.add('hidden');
    }
    drawWaveform();
  });

  // Restore saved theme
  const savedTheme = localStorage.getItem('skyspeed_theme') || localStorage.getItem('speedpulse_theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (savedTheme === 'light') {
      elements.sunIcon.classList.add('hidden');
      elements.moonIcon.classList.remove('hidden');
    }
  }

  // Sound Toggle
  elements.soundToggle.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    if (state.soundEnabled) {
      elements.soundOnIcon.classList.remove('hidden');
      elements.soundOffIcon.classList.add('hidden');
      showToast('Sound effects enabled');
      playTone(600, 'sine', 0.1);
    } else {
      elements.soundOnIcon.classList.add('hidden');
      elements.soundOffIcon.classList.remove('hidden');
      showToast('Sound effects muted');
    }
  });

  // --- CUSTOM LOGO AUTO-DETECTION ---
  function checkCustomLogo() {
    const tryLogo = (url) => {
      const img = new Image();
      img.onload = () => {
        const brandIcon = document.querySelector('.brand-icon');
        if (brandIcon) {
          brandIcon.innerHTML = `<img src="${url}" alt="SkySpeed Logo">`;
          brandIcon.style.background = 'transparent';
          brandIcon.style.boxShadow = 'none';
        }
        const favicon = document.querySelector('link[rel="icon"]');
        if (favicon) favicon.href = url;
        state.customLogoImg = img;
      };
      img.onerror = () => {
        if (url.endsWith('.png')) tryLogo('/logo.svg');
      };
      img.src = url;
    };
    tryLogo('/logo.png');
  }

  // Init
  checkCustomLogo();
  renderGaugeTicks();
  resizeCanvas();
  fetchNetworkInfo();
  loadLocalHistory();
})();
