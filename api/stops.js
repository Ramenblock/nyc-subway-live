/**
 * api/stops.js
 *
 * Fetches all NYC subway station coordinates from the NYC Open Data portal.
 * This is completely free and requires no API key.
 *
 * The data is cached for 24 hours since stations almost never change.
 * The result is a lookup table: stop_id → { name, lat, lon }
 *
 * Why do we need this?
 *   The MTA's real-time feed tells us which stop a train is near.
 *   To put it on a map, we need to know where that stop actually is.
 *   This endpoint gives us those coordinates.
 *
 * Important detail about stop IDs:
 *   MTA uses IDs like "A27N" and "A27S" (N = northbound, S = southbound).
 *   NYC Open Data uses the base ID "A27" without direction.
 *   We store both so lookups always work.
 */

// In-memory cache — persists between requests on the same Vercel instance
let cache = null;
let cacheTime = 0;
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');

  // Return cached data if it's still fresh
  if (cache && (Date.now() - cacheTime) < CACHE_DURATION_MS) {
    return res.status(200).json(cache);
  }

  try {
    const stops = await fetchStopsFromOpenData();
    cache = stops;
    cacheTime = Date.now();
    return res.status(200).json(stops);
  } catch (error) {
    console.error('Failed to fetch stops from NYC Open Data:', error.message);

    // If we have stale cache, use it rather than failing completely
    if (cache) {
      return res.status(200).json(cache);
    }

    return res.status(500).json({ error: 'Could not load station data: ' + error.message });
  }
};

/**
 * Fetches subway stations from the NYC Open Data API.
 * Dataset: "Subway Stations" — https://data.cityofnewyork.us/Transportation/Subway-Stations/arq3-7z49
 */
async function fetchStopsFromOpenData() {
  // $limit=2000 ensures we get all stations (there are ~496)
  const url = 'https://data.cityofnewyork.us/resource/arq3-7z49.json?$limit=2000';

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`NYC Open Data returned HTTP ${response.status}`);
  }

  const stations = await response.json();
  const stops = {};

  for (const station of stations) {
    // Skip entries missing critical data
    if (!station.gtfs_stop_id || !station.the_geom) continue;

    const baseId   = station.gtfs_stop_id.trim();
    const name     = station.stop_name || baseId;
    const coords   = station.the_geom.coordinates; // [longitude, latitude]
    const lat      = parseFloat(coords[1]);
    const lon      = parseFloat(coords[0]);

    if (isNaN(lat) || isNaN(lon)) continue;

    const entry = { name, lat, lon };

    // Store under the base ID and both directional variants
    stops[baseId]        = entry;
    stops[baseId + 'N']  = entry;
    stops[baseId + 'S']  = entry;
  }

  return stops;
}
