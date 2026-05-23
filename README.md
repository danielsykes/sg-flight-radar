# sg-flight-radar

Flight radar display for smart displays – Tron / War Games style radar showing live flights over Singapore.

![Aesthetic: retro CRT radar with neon green blips, sweep line, and monospace typography]

## Architecture

- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
- **Worker**: Cloudflare Worker proxy for flight data APIs (CORS, failover, credential isolation)

## Features

- Real-time radar sweep animation (canvas-based)
- Flight blips with heading indicators and trails
- Climb/descend coloring and vertical rate arrows
- Callsign, altitude (flight level), speed, airline display
- Changi Airport runway overlay
- Wind indicator (sourced from Open-Meteo)
- Traffic sparkline showing aircraft count over time
- Closest aircraft highlighting
- Smooth position interpolation between refreshes
- Audio blip on new aircraft detection
- Scanline CRT overlay effect with vignette
- 80km radius coverage centered on Singapore
- Auto-refreshes every 15 seconds
- Optimised for 1024×600 smart display format

## Data Sources

- **Primary**: [OpenSky Network](https://opensky-network.org/) – free ADS-B flight tracking API
- **Failover**: [airplanes.live](https://airplanes.live/) – community ADS-B data (no auth required)
- **Wind**: [Open-Meteo](https://open-meteo.com/) – free weather API

## Setup

### 1. Deploy the Cloudflare Worker

```bash
cd worker
npx wrangler deploy
```

Optionally set credentials for higher OpenSky rate limits:

```bash
npx wrangler secret put OPENSKY_USER
npx wrangler secret put OPENSKY_PASS
```

### 2. Update the API URL

In `js/app.js`, update `CONFIG.apiUrl` to your deployed worker URL.

### 3. Enable GitHub Pages

Settings → Pages → Deploy from branch `main`, root `/`.

### 4. Display

Open the GitHub Pages URL on your target display device.

## Local Development

Open `index.html` in a browser. The worker must be deployed for data to load.

## Customisation

- `CONFIG.centerLat` / `CONFIG.centerLng` – radar center point
- `CONFIG.radiusKm` – coverage radius
- `CONFIG.refreshInterval` – data refresh rate (ms)
- `CONFIG.sweepSpeed` – radar sweep rotation speed (ms per revolution)
