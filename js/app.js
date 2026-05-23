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
};

// ── State ────────────────────────────────────────────────────
let flights = [];
let sweepAngle = 0;
let lastSweepTime = performance.now();
let canvas, ctx;
let radarSize = 0;

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
  const maxW = container.clientWidth - 240; // account for flight list
  radarSize = Math.min(maxH, maxW);
  canvas.width = radarSize * window.devicePixelRatio;
  canvas.height = radarSize * window.devicePixelRatio;
  canvas.style.width = radarSize + "px";
  canvas.style.height = radarSize + "px";
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
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

  ctx.restore();
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

  flights.forEach((f) => {
    const pos = latLngToRadar(f.lat, f.lng);
    if (!pos) return;

    const x = pos.x;
    const y = pos.y;

    // Determine blip age for fade effect
    const age = f.age || 1;
    const alpha = Math.max(0.3, 1 - age * 0.1);

    // Blip glow
    ctx.shadowColor = `rgba(0, 255, 136, ${alpha * 0.8})`;
    ctx.shadowBlur = 6;

    // Draw blip (triangle showing heading)
    const heading = ((f.heading || 0) - 90) * (Math.PI / 180);
    const size = 5;

    ctx.beginPath();
    ctx.moveTo(x + Math.cos(heading) * size * 1.5, y + Math.sin(heading) * size * 1.5);
    ctx.lineTo(x + Math.cos(heading + 2.5) * size, y + Math.sin(heading + 2.5) * size);
    ctx.lineTo(x + Math.cos(heading - 2.5) * size, y + Math.sin(heading - 2.5) * size);
    ctx.closePath();
    ctx.fillStyle = `rgba(0, 255, 204, ${alpha})`;
    ctx.fill();

    ctx.shadowBlur = 0;

    // Callsign label
    if (f.callsign) {
      ctx.fillStyle = `rgba(0, 255, 136, ${alpha * 0.8})`;
      ctx.font = "8px 'Courier New'";
      ctx.textAlign = "left";
      ctx.fillText(f.callsign, x + 8, y - 4);
    }

    // Altitude label
    if (f.altitude) {
      ctx.fillStyle = `rgba(0, 85, 51, ${alpha * 0.8})`;
      ctx.font = "7px 'Courier New'";
      ctx.fillText(`FL${Math.round(f.altitude / 100)}`, x + 8, y + 5);
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

  // Calculate distance and bearing from center
  const dLat = (lat - CONFIG.centerLat) * 111.32; // km per degree lat
  const dLng = (lng - CONFIG.centerLng) * 111.32 * Math.cos(CONFIG.centerLat * Math.PI / 180);
  const distKm = Math.sqrt(dLat * dLat + dLng * dLng);

  if (distKm > CONFIG.radiusKm) return null;

  const r = (distKm / CONFIG.radiusKm) * maxR;
  const angle = Math.atan2(-dLat, dLng); // negative dLat because screen Y is inverted

  // Convert: North is up (angle 0 = East, so rotate -90)
  const screenAngle = angle - Math.PI / 2;

  return {
    x: cx + Math.cos(screenAngle + Math.PI / 2) * r * (dLng / (distKm || 1)),
    y: cy - r * (dLat / (distKm || 1)),
  };
}

// Simpler & correct lat/lng to pixel
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

  drawGrid();
  drawSweep();
  drawFlights();

  requestAnimationFrame(animate);
}

// ── Flight Data ──────────────────────────────────────────────
async function fetchFlights() {
  try {
    const { centerLat, centerLng, radiusKm } = CONFIG;
    // Bounding box approx
    const latDeg = radiusKm / 111.32;
    const lngDeg = radiusKm / (111.32 * Math.cos(centerLat * Math.PI / 180));

    const url = `${CONFIG.apiUrl}?lamin=${centerLat - latDeg}&lamax=${centerLat + latDeg}&lomin=${centerLng - lngDeg}&lomax=${centerLng + lngDeg}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();

    if (data.states) {
      // Store previous positions as trails
      const prevMap = new Map(flights.map(f => [f.icao24, f]));

      flights = data.states.map((s) => {
        const icao24 = s[0];
        const prev = prevMap.get(icao24);
        const trail = prev ? [...(prev.trail || []).slice(-5), { lat: prev.lat, lng: prev.lng }] : [];

        return {
          icao24,
          callsign: (s[1] || "").trim(),
          country: s[2],
          lat: s[6],
          lng: s[5],
          altitude: s[7], // geometric altitude in meters
          heading: s[10],
          velocity: s[9], // m/s
          verticalRate: s[11],
          onGround: s[8],
          trail,
          age: 0,
        };
      }).filter(f => f.lat && f.lng && !f.onGround);
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
    .slice(0, 15);

  container.innerHTML = sorted.map((f) => {
    const altFl = f.altitude ? `FL${Math.round(f.altitude / 30.48 / 100)}` : "---";
    const speed = f.velocity ? `${Math.round(f.velocity * 1.944)}kt` : "";
    return `
      <div class="flight-item">
        <span class="flight-callsign">${f.callsign || f.icao24}</span>
        <span class="flight-alt">${altFl}</span>
        <span class="flight-speed">${speed}</span>
      </div>`;
  }).join("");
}

function updateStats() {
  document.getElementById("stats").textContent =
    `${flights.length} aircraft in ${CONFIG.radiusKm}km`;
}

function getDistance(lat, lng) {
  const dLat = (lat - CONFIG.centerLat) * 111.32;
  const dLng = (lng - CONFIG.centerLng) * 111.32 * Math.cos(CONFIG.centerLat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ── Init ─────────────────────────────────────────────────────
updateClock();
setInterval(updateClock, 1_000);

initCanvas();
requestAnimationFrame(animate);

fetchFlights();
setInterval(fetchFlights, CONFIG.refreshInterval);
