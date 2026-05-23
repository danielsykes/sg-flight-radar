/*
 * Cloudflare Worker – OpenSky Network API proxy
 *
 * Proxies requests to OpenSky Network and adds CORS headers
 * so the GitHub Pages frontend can access flight data.
 *
 * OpenSky's free API allows unauthenticated access with rate
 * limits (~100 requests/day for anonymous, more with credentials).
 * Set OPENSKY_USER and OPENSKY_PASS environment variables for
 * authenticated access (10s polling, 4000 req/day).
 *
 * Deploy: npx wrangler deploy
 *
 * Usage from the frontend:
 *   GET https://YOUR-WORKER.workers.dev?lamin=0.5&lamax=2.2&lomin=103&lomax=104.5
 */

const OPENSKY_BASE = "https://opensky-network.org/api/states/all";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const lamin = url.searchParams.get("lamin");
    const lamax = url.searchParams.get("lamax");
    const lomin = url.searchParams.get("lomin");
    const lomax = url.searchParams.get("lomax");

    if (!lamin || !lamax || !lomin || !lomax) {
      return new Response(
        JSON.stringify({ error: "Bounding box params required: lamin, lamax, lomin, lomax" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Build OpenSky API URL
    const openSkyUrl = `${OPENSKY_BASE}?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;

    // Build headers (optional authentication)
    const headers = { Accept: "application/json" };
    if (env.OPENSKY_USER && env.OPENSKY_PASS) {
      const auth = btoa(`${env.OPENSKY_USER}:${env.OPENSKY_PASS}`);
      headers["Authorization"] = `Basic ${auth}`;
    }

    try {
      const apiRes = await fetch(openSkyUrl, { headers });
      const body = await apiRes.text();

      return new Response(body, {
        status: apiRes.status,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=10",
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch from OpenSky", detail: err.message }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  },
};
