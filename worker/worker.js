/*
 * Cloudflare Worker – Flight data API proxy with failover
 *
 * Primary: OpenSky Network API
 * Fallback: airplanes.live (ADS-B community data)
 *
 * Tries OpenSky first; if it fails or times out (3s), falls back
 * to airplanes.live which is more reliable.
 *
 * Deploy: npx wrangler deploy
 *
 * Usage from the frontend:
 *   GET https://YOUR-WORKER.workers.dev?lamin=0.5&lamax=2.2&lomin=103&lomax=104.5
 */

const OPENSKY_BASE = "https://opensky-network.org/api/states/all";
const OPENSKY_TIMEOUT_MS = 3000;

const ALLOWED_ORIGINS = [
  "https://danielsykes.github.io",
  "http://localhost",
  "http://127.0.0.1",
];

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonResponse(body, status = 200, extra = {}, request = null) {
  const cors = request ? getCorsHeaders(request) : { "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0] };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=10", ...extra },
  });
}

// Fetch from airplanes.live and normalize to OpenSky "states" format
async function fetchAirplanesLive(lamin, lamax, lomin, lomax) {
  const centerLat = (parseFloat(lamin) + parseFloat(lamax)) / 2;
  const centerLng = (parseFloat(lomin) + parseFloat(lomax)) / 2;
  // Approximate radius in nautical miles from bounding box
  const latSpanKm = (parseFloat(lamax) - parseFloat(lamin)) * 111.32;
  const radiusNm = Math.round((latSpanKm / 2) / 1.852);

  const url = `https://api.airplanes.live/v2/point/${centerLat}/${centerLng}/${radiusNm}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`airplanes.live ${res.status}`);
  const data = await res.json();

  // Normalize to OpenSky states format with extra fields:
  // [icao24, callsign, origin_country, time_position, last_contact,
  //  longitude, latitude, geo_altitude, on_ground, velocity, true_track,
  //  vertical_rate, operator, aircraft_type]
  const states = (data.ac || []).map((ac) => [
    ac.hex || "",                    // 0: icao24
    ac.flight || "",                 // 1: callsign
    ac.r || "",                      // 2: origin country (registration)
    null,                            // 3: time_position
    null,                            // 4: last_contact
    ac.lon,                          // 5: longitude
    ac.lat,                          // 6: latitude
    (ac.alt_geom || ac.alt_baro) * 0.3048 || null, // 7: geo_altitude (ft -> m)
    ac.alt_baro === "ground",        // 8: on_ground
    (ac.gs || 0) * 0.5144,          // 9: velocity (knots -> m/s)
    ac.track || 0,                   // 10: true_track
    ac.baro_rate ? ac.baro_rate * 0.00508 : 0, // 11: vertical_rate (fpm -> m/s)
    ac.ownOp || "",                  // 12: operator/airline
    ac.t || "",                      // 13: aircraft type
    ac.ownOp ? "" : "",              // 14: origin (not available from ADS-B)
    ac.ownOp ? "" : "",              // 15: destination (not available from ADS-B)
  ]);

  return { time: Math.floor(Date.now() / 1000), states, source: "airplanes.live" };
}

// Fetch from OpenSky with timeout
async function fetchOpenSky(lamin, lamax, lomin, lomax, env) {
  const openSkyUrl = `${OPENSKY_BASE}?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;

  const headers = { Accept: "application/json" };
  if (env.OPENSKY_USER && env.OPENSKY_PASS) {
    const auth = btoa(`${env.OPENSKY_USER}:${env.OPENSKY_PASS}`);
    headers["Authorization"] = `Basic ${auth}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENSKY_TIMEOUT_MS);

  try {
    const res = await fetch(openSkyUrl, { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`OpenSky ${res.status}`);
    const data = await res.json();
    data.source = "opensky";
    return data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: getCorsHeaders(request) });
    }

    const url = new URL(request.url);
    const lamin = url.searchParams.get("lamin");
    const lamax = url.searchParams.get("lamax");
    const lomin = url.searchParams.get("lomin");
    const lomax = url.searchParams.get("lomax");

    if (!lamin || !lamax || !lomin || !lomax) {
      // Friendly response for direct browser visits
      if (!lamin && !lamax && !lomin && !lomax) {
        return jsonResponse({
          service: "sg-flight-proxy",
          status: "ok",
          usage: "GET /?lamin=0.5&lamax=2.2&lomin=103&lomax=104.5",
          sources: ["OpenSky Network (primary)", "airplanes.live (failover)"],
        }, 200, {}, request);
      }
      return jsonResponse({ error: "Bounding box params required: lamin, lamax, lomin, lomax" }, 400, {}, request);
    }

    // Validate bounding box params are reasonable numbers
    const nums = [lamin, lamax, lomin, lomax].map(Number);
    if (nums.some(n => isNaN(n) || n < -180 || n > 180)) {
      return jsonResponse({ error: "Invalid bounding box values" }, 400, {}, request);
    }
    // Prevent excessively large bounding boxes (max ~5 degrees span)
    if (Math.abs(nums[1] - nums[0]) > 5 || Math.abs(nums[3] - nums[2]) > 5) {
      return jsonResponse({ error: "Bounding box too large (max 5° span)" }, 400, {}, request);
    }

    // Try OpenSky first, failover to airplanes.live
    let flightData;
    try {
      flightData = await fetchOpenSky(lamin, lamax, lomin, lomax, env);
    } catch (openSkyErr) {
      console.log(`OpenSky failed (${openSkyErr.message}), falling back to airplanes.live`);
      try {
        flightData = await fetchAirplanesLive(lamin, lamax, lomin, lomax);
      } catch (fallbackErr) {
        return jsonResponse(
          { error: "All flight data sources unavailable" },
          502, {}, request
        );
      }
    }

    // Attach wind data (non-blocking, cached)
    try {
      const windRes = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=1.3521&longitude=103.8198&current=wind_speed_10m,wind_direction_10m",
        { cf: { cacheTtl: 300 } }
      );
      if (windRes.ok) {
        const windJson = await windRes.json();
        if (windJson.current) {
          flightData.wind = {
            speed: Math.round(windJson.current.wind_speed_10m * 0.54), // km/h to kt
            direction: windJson.current.wind_direction_10m,
          };
        }
      }
    } catch (e) { /* wind is optional */ }

    return jsonResponse(flightData, 200, {}, request);
  },
};
