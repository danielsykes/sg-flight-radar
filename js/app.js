/*
 * sg-flight-radar – Flight radar display for Google Nest Hub
 * Visual: Tron / War Games inspired radar sweep
 * Data: OpenSky Network API via Cloudflare Worker proxy
 */

const CONFIG = {
  apiUrl: "https://sg-flight-proxy.danielsykes.workers.dev",
  centerLat: 1.3521,
  centerLng: 103.8198,
  radiusKm: 80,
  refreshInterval: 15_000,
  sweepSpeed: 4_000, // ms per full rotation
  // Changi Airport runways (approximate coordinates)
  changiRunways: [
    { name: "02L/20R", start: [1.3403, 103.9893], end: [1.3636, 103.9970] },
    { name: "02C/20C", start: [1.3375, 103.9845], end: [1.3608, 103.9922] },
  ],
};

// ── State ────────────────────────────────────────────────────
let flights = [];
let prevFlightIds = new Set();
let sweepAngle = 0;
let lastSweepTime = performance.now();
let canvas, ctx;
let radarSize = 0;
let trafficHistory = []; // sparkline data
let windData = null; // { speed, direction }
let lastAnimateTime = 0;

// ── Clock ────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toLocaleTimeString(
    "en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
  );
}

// ── Canvas Setup ─────────────────────────────────────────────
function initCanvas() {
  canvas = document.getElementById("radar");
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  const container = canvas.parentElement;
  const maxH = container.clientHeight;
  // Use the actual remaining width (container minus the flight-list sidebar)
  const sidebar = document.getElementById("flight-list");
  const gap = 16; // matches CSS gap
  const maxW = container.clientWidth - (sidebar ? sidebar.offsetWidth + gap : 0);
  radarSize = Math.floor(Math.min(maxH, maxW));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = radarSize * dpr;
  canvas.height = radarSize * dpr;
  canvas.style.width = radarSize + "px";
  canvas.style.height = radarSize + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Radar Drawing ────────────────────────────────────────────
function drawGrid() {
  const cx = radarSize / 2;
  const cy = radarSize / 2;
  const maxR = radarSize / 2 - 4;

  // Background
  ctx.fillStyle = "#0a0c0a";
  ctx.fillRect(0, 0, radarSize, radarSize);

  // Circular mask
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.clip();

  // Radial gradient background
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  grad.addColorStop(0, "#0d1a0d");
  grad.addColorStop(1, "#050a05");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, radarSize, radarSize);

  // Concentric rings (distance markers)
  ctx.strokeStyle = "rgba(0, 80, 50, 0.5)";
  ctx.lineWidth = 0.5;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (maxR / 4) * i, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Distance labels
  ctx.fillStyle = "rgba(0, 80, 50, 0.7)";
  ctx.font = "9px 'Courier New'";
  ctx.textAlign = "center";
  for (let i = 1; i <= 4; i++) {
    const r = (maxR / 4) * i;
    const km = Math.round((CONFIG.radiusKm / 4) * i);
    ctx.fillText(`${km}km`, cx, cy - r + 12);
  }

  // Crosshair lines
  ctx.strokeStyle = "rgba(0, 80, 50, 0.4)";
  ctx.lineWidth = 0.5;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    ctx.stroke();
  }

  // Cardinal directions
  ctx.fillStyle = "rgba(0, 255, 136, 0.6)";
  ctx.font = "bold 11px 'Courier New'";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labels = [
    { text: "N", angle: -Math.PI / 2 },
    { text: "E", angle: 0 },
    { text: "S", angle: Math.PI / 2 },
    { text: "W", angle: Math.PI },
  ];
  labels.forEach(({ text, angle }) => {
    const r = maxR - 14;
    ctx.fillText(text, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  });

  // Center dot
  ctx.fillStyle = "#00ff88";
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Changi runway overlay
  drawRunways(cx, cy, maxR);

  ctx.restore();
}

function drawRunways() {
  const cx = radarSize / 2;
  const cy = radarSize / 2;
  const maxR = radarSize / 2 - 20;

  CONFIG.changiRunways.forEach((rwy) => {
    const start = latLngToRadar(rwy.start[0], rwy.start[1]);
    const end = latLngToRadar(rwy.end[0], rwy.end[1]);
    if (!start || !end) return;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = "rgba(255, 170, 0, 0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Runway label
    ctx.fillStyle = "rgba(255, 170, 0, 0.5)";
    ctx.font = "7px 'Courier New'";
    ctx.textAlign = "center";
    ctx.fillText(rwy.name, (start.x + end.x) / 2 + 12, (start.y + end.y) / 2);
  });
}

function drawWindIndicator() {
  // Wind is now displayed in the sidebar DOM element
  if (!windData) return;
  const el = document.getElementById("wind-info");
  if (el) {
    const arrow = getWindArrow(windData.direction);
    el.textContent = `${arrow} WIND ${windData.speed}kt ${Math.round(windData.direction)}°`;
  }
}

function getWindArrow(deg) {
  // 8-point compass arrows showing wind FROM direction
  const arrows = ["↓", "↙", "←", "↖", "↑", "↗", "→", "↘"];
  return arrows[Math.round(deg / 45) % 8];
}

function drawSweep() {
  const cx = radarSize / 2;
  const cy = radarSize / 2;
  const maxR = radarSize / 2 - 4;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.clip();

  // Sweep gradient (fading trail)
  const sweepGrad = ctx.createConicalGradient
    ? null // not all browsers support this
    : null;

  // Draw sweep as a filled arc with gradient
  const trailAngle = Math.PI / 3; // 60 degree trail
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, maxR, sweepAngle - trailAngle, sweepAngle);
  ctx.closePath();

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  grad.addColorStop(0, "rgba(0, 255, 136, 0.15)");
  grad.addColorStop(0.7, "rgba(0, 255, 136, 0.05)");
  grad.addColorStop(1, "rgba(0, 255, 136, 0.02)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Sweep line
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
  ctx.strokeStyle = "rgba(0, 255, 136, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(0, 255, 136, 0.6)";
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawFlights() {
  const cx = radarSize / 2;
  const cy = radarSize / 2;
  const maxR = radarSize / 2 - 4;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.clip();

  // Find closest aircraft for highlighting
  let closestDist = Infinity;
  let closestIcao = null;
  flights.forEach((f) => {
    const d = getDistance(f.lat, f.lng);
    if (d < closestDist) { closestDist = d; closestIcao = f.icao24; }
  });

  flights.forEach((f) => {
    const pos = latLngToRadar(f.lat, f.lng);
    if (!pos) return;

    const x = pos.x;
    const y = pos.y;
    const isClosest = f.icao24 === closestIcao;

    // Determine blip age for fade effect
    const age = f.age || 1;
    const alpha = Math.max(0.3, 1 - age * 0.1);

    // Color based on vertical rate: green=level, cyan=climbing, amber=descending
    let blipColor;
    if (f.verticalRate > 1) blipColor = `rgba(0, 200, 255, ${alpha})`; // climbing
    else if (f.verticalRate < -1) blipColor = `rgba(255, 170, 0, ${alpha})`; // descending
    else blipColor = `rgba(0, 255, 204, ${alpha})`; // level

    // Blip glow (brighter for closest)
    const glowAlpha = isClosest ? 1 : alpha * 0.8;
    const glowSize = isClosest ? 10 : 6;
    ctx.shadowColor = isClosest ? "rgba(255, 255, 255, 0.9)" : `rgba(0, 255, 136, ${glowAlpha})`;
    ctx.shadowBlur = glowSize;

    // Draw blip (triangle showing heading)
    const heading = ((f.heading || 0) - 90) * (Math.PI / 180);
    const size = isClosest ? 7 : 5;

    ctx.beginPath();
    ctx.moveTo(x + Math.cos(heading) * size * 1.5, y + Math.sin(heading) * size * 1.5);
    ctx.lineTo(x + Math.cos(heading + 2.5) * size, y + Math.sin(heading + 2.5) * size);
    ctx.lineTo(x + Math.cos(heading - 2.5) * size, y + Math.sin(heading - 2.5) * size);
    ctx.closePath();
    ctx.fillStyle = isClosest ? "#ffffff" : blipColor;
    ctx.fill();

    ctx.shadowBlur = 0;

    // Callsign label
    if (f.callsign) {
      ctx.fillStyle = isClosest ? "rgba(255, 255, 255, 0.9)" : `rgba(0, 255, 136, ${alpha * 0.8})`;
      ctx.font = isClosest ? "bold 9px 'Courier New'" : "8px 'Courier New'";
      ctx.textAlign = "left";
      ctx.fillText(f.callsign, x + 8, y - 4);
    }

    // Altitude label with climb/descend arrow
    if (f.altitude) {
      const arrow = f.verticalRate > 1 ? "↑" : f.verticalRate < -1 ? "↓" : "";
      ctx.fillStyle = f.verticalRate > 1 ? `rgba(0, 200, 255, ${alpha * 0.8})`
        : f.verticalRate < -1 ? `rgba(255, 170, 0, ${alpha * 0.8})`
        : `rgba(0, 85, 51, ${alpha * 0.8})`;
      ctx.font = "7px 'Courier New'";
      ctx.fillText(`${arrow}FL${Math.round(f.altitude / 100)}`, x + 8, y + 5);
    }

    // Trail (previous positions)
    if (f.trail && f.trail.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(0, 255, 136, ${alpha * 0.2})`;
      ctx.lineWidth = 0.5;
      f.trail.forEach((t, i) => {
        const tp = latLngToRadar(t.lat, t.lng);
        if (!tp) return;
        if (i === 0) ctx.moveTo(tp.x, tp.y);
        else ctx.lineTo(tp.x, tp.y);
      });
      ctx.stroke();
    }
  });

  ctx.restore();
}

function latLngToRadar(lat, lng) {
  const cx = radarSize / 2;
  const cy = radarSize / 2;
  const maxR = radarSize / 2 - 20;

  const dLat = (lat - CONFIG.centerLat) * 111.32;
  const dLng = (lng - CONFIG.centerLng) * 111.32 * Math.cos(CONFIG.centerLat * Math.PI / 180);
  const distKm = Math.sqrt(dLat * dLat + dLng * dLng);

  if (distKm > CONFIG.radiusKm) return null;

  const px = (dLng / CONFIG.radiusKm) * maxR;
  const py = -(dLat / CONFIG.radiusKm) * maxR; // negative because screen Y is down

  return { x: cx + px, y: cy + py };
}

// ── Animation Loop ───────────────────────────────────────────
function animate(now) {
  const dt = now - lastSweepTime;
  lastSweepTime = now;

  sweepAngle += (dt / CONFIG.sweepSpeed) * Math.PI * 2;
  if (sweepAngle > Math.PI * 2) sweepAngle -= Math.PI * 2;

  // Smooth interpolation: move flights toward target positions
  interpolateFlights(dt);

  drawGrid();
  drawSweep();
  drawFlights();

  requestAnimationFrame(animate);
}

// ── Smooth Interpolation ─────────────────────────────────────
function interpolateFlights(dt) {
  const lerpFactor = Math.min(1, dt / 2000); // smooth over ~2s
  flights.forEach((f) => {
    if (f._targetLat !== undefined && f._targetLng !== undefined) {
      f.lat += (f._targetLat - f.lat) * lerpFactor;
      f.lng += (f._targetLng - f.lng) * lerpFactor;
    }
  });
}

// ── Audio ────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playBlipSound() {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

// ── Flight Data ──────────────────────────────────────────────
async function fetchFlights() {
  try {
    const { centerLat, centerLng, radiusKm } = CONFIG;
    const latDeg = radiusKm / 111.32;
    const lngDeg = radiusKm / (111.32 * Math.cos(centerLat * Math.PI / 180));

    const url = `${CONFIG.apiUrl}?lamin=${centerLat - latDeg}&lamax=${centerLat + latDeg}&lomin=${centerLng - lngDeg}&lomax=${centerLng + lngDeg}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();

    if (data.states) {
      // Update source indicator
      const sourceNames = { opensky: "OpenSky Network", "airplanes.live": "airplanes.live" };
      document.querySelector(".source").textContent = sourceNames[data.source] || data.source || "Unknown";

      // Update wind from response
      if (data.wind) {
        windData = data.wind;
        drawWindIndicator();
      }

      // Store previous positions as trails
      const prevMap = new Map(flights.map(f => [f.icao24, f]));
      const newFlightIds = new Set();

      flights = data.states.map((s) => {
        const icao24 = s[0];
        newFlightIds.add(icao24);
        const prev = prevMap.get(icao24);
        const trail = prev ? [...(prev.trail || []).slice(-5), { lat: prev.lat, lng: prev.lng }] : [];

        return {
          icao24,
          callsign: (s[1] || "").trim(),
          country: s[2],
          // For interpolation: keep current display position, set target
          lat: prev ? prev.lat : s[6],
          lng: prev ? prev.lng : s[5],
          _targetLat: s[6],
          _targetLng: s[5],
          altitude: s[7],
          heading: s[10],
          velocity: s[9],
          verticalRate: s[11],
          onGround: s[8],
          airline: s[12] || deriveAirline(s[1]),
          aircraftType: s[13] || "",
          trail,
          age: 0,
        };
      }).filter(f => f._targetLat && f._targetLng && !f.onGround);

      // Detect new aircraft entering and play blip
      newFlightIds.forEach((id) => {
        if (!prevFlightIds.has(id)) playBlipSound();
      });
      prevFlightIds = newFlightIds;

      // Update sparkline
      trafficHistory.push({ time: Date.now(), count: flights.length });
      if (trafficHistory.length > 60) trafficHistory.shift(); // keep ~15 min of data
    }

    updateFlightList();
    updateStats();
    document.getElementById("updated").textContent =
      `Updated ${new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`;
  } catch (err) {
    console.error("Flight fetch failed:", err);
    document.getElementById("updated").textContent = `Error: ${err.message}`;
  }
}

function updateFlightList() {
  const container = document.getElementById("flights");
  const sorted = [...flights]
    .sort((a, b) => {
      const dA = getDistance(a.lat, a.lng);
      const dB = getDistance(b.lat, b.lng);
      return dA - dB;
    })
    .slice(0, 12);

  container.innerHTML = sorted.map((f, i) => {
    const altFl = f.altitude ? `FL${Math.round(f.altitude / 30.48 / 100)}` : "---";
    const speed = f.velocity ? `${Math.round(f.velocity * 1.944)}kt` : "";
    const airline = f.airline || "";
    const isClosest = i === 0;
    const vArrow = f.verticalRate > 1 ? "↑" : f.verticalRate < -1 ? "↓" : "";
    const vClass = f.verticalRate > 1 ? "climbing" : f.verticalRate < -1 ? "descending" : "";
    return `
      <div class="flight-item${isClosest ? " closest" : ""}">
        <div class="flight-row-top">
          <span class="flight-callsign">${f.callsign || f.icao24}</span>
          <span class="flight-alt ${vClass}">${vArrow}${altFl}</span>
          <span class="flight-speed">${speed}</span>
        </div>
        ${airline ? `<div class="flight-row-bottom"><span class="flight-airline">${airline}</span>${f.aircraftType ? `<span class="flight-type">${f.aircraftType}</span>` : ""}</div>` : ""}
      </div>`;
  }).join("");
}

function updateStats() {
  const statsEl = document.getElementById("stats");
  const sparkline = trafficHistory.length > 1 ? drawSparklineSVG() : "";
  statsEl.innerHTML = `${flights.length} aircraft ${sparkline}`;
}

function drawSparklineSVG() {
  const w = 60, h = 16;
  const data = trafficHistory.map(d => d.count);
  const max = Math.max(...data, 1);
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - (v / max) * h}`
  ).join(" ");
  return `<svg width="${w}" height="${h}" style="vertical-align:middle;margin-left:8px;"><polyline points="${points}" fill="none" stroke="#00ff88" stroke-width="1" opacity="0.6"/></svg>`;
}

// Derive airline name from ICAO callsign prefix
const AIRLINES = {
  SIA: "Singapore Airlines", SLK: "Silk Air", SCO: "Scoot",
  MAS: "Malaysia Airlines", AXM: "AirAsia", CPA: "Cathay Pacific",
  QFA: "Qantas", JST: "Jetstar", SQC: "SQ Cargo",
  UAE: "Emirates", ETD: "Etihad", QTR: "Qatar Airways",
  BAW: "British Airways", DLH: "Lufthansa", AFR: "Air France",
  KLM: "KLM", THY: "Turkish Airlines", EVA: "EVA Air",
  CCA: "Air China", CES: "China Eastern", CSN: "China Southern",
  ANA: "ANA", JAL: "Japan Airlines", KAL: "Korean Air",
  AAR: "Asiana", VJC: "VietJet", HVN: "Vietnam Airlines",
  GIA: "Garuda", LNI: "Lion Air", THA: "Thai Airways",
  FDX: "FedEx", UPS: "UPS", GTI: "Atlas Air",
};

function deriveAirline(callsign) {
  if (!callsign) return "";
  const prefix = callsign.trim().substring(0, 3).toUpperCase();
  return AIRLINES[prefix] || "";
}

function getDistance(lat, lng) {
  const dLat = (lat - CONFIG.centerLat) * 111.32;
  const dLng = (lng - CONFIG.centerLng) * 111.32 * Math.cos(CONFIG.centerLat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ── Wind Data ────────────────────────────────────────────────
// Wind is now fetched by the worker and included in flight responses

// ── Init ─────────────────────────────────────────────────────
updateClock();
setInterval(updateClock, 1_000);

initCanvas();
requestAnimationFrame(animate);

fetchFlights();
setInterval(fetchFlights, CONFIG.refreshInterval);
