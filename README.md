# sg-flight-radar

Flight radar display for Google Nest Hub – Tron / War Games style radar showing live flights over Singapore.

![Aesthetic: retro CRT radar with neon green blips, sweep line, and monospace typography]

## Architecture

Same pattern as [sg-bus-display](https://github.com/danielsykes/sg-bus-display):

- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
- **Worker**: Cloudflare Worker proxy for OpenSky Network API (keeps credentials secret, adds CORS)

## Features

- Real-time radar sweep animation (canvas-based)
- Flight blips with heading indicators and trails
- Callsign, altitude (flight level), and speed display
- Scanline CRT overlay effect
- 80km radius coverage centered on Singapore
- Auto-refreshes every 15 seconds
- Optimised for 1024×600 (Nest Hub) display

## Data Source

[OpenSky Network](https://opensky-network.org/) – free ADS-B flight tracking API.

- Anonymous: ~100 requests/day, 10s resolution
- Authenticated: ~4000 requests/day (set `OPENSKY_USER` / `OPENSKY_PASS` in worker env)

## Setup

### 1. Deploy the Cloudflare Worker

```bash
cd worker
npx wrangler deploy
```

Optionally set credentials for higher rate limits:

```bash
npx wrangler secret put OPENSKY_USER
npx wrangler secret put OPENSKY_PASS
```

### 2. Update the API URL

In `js/app.js`, update `CONFIG.apiUrl` to your deployed worker URL.

### 3. Enable GitHub Pages

Settings → Pages → Deploy from branch `main`, root `/`.

### 4. Cast to Nest Hub

Open the GitHub Pages URL in Chrome and cast the tab to your Google Nest Hub.

## Local Development

Just open `index.html` in a browser. You'll need the worker deployed (or temporarily point `apiUrl` to OpenSky directly for testing).

## Customisation

- `CONFIG.centerLat` / `CONFIG.centerLng` – radar center point
- `CONFIG.radiusKm` – coverage radius
- `CONFIG.refreshInterval` – data refresh rate (ms)
- `CONFIG.sweepSpeed` – radar sweep rotation speed (ms per revolution)
