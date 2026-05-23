/**
 * api/lines.js
 *
 * Returns GeoJSON LineString features for every NYC subway route, built
 * directly from the MTA's official GTFS static data (the same ZIP file
 * used by api/stops.js).
 *
 * Process:
 *   1. Download the GTFS ZIP (~3 MB)
 *   2. Parse trips.txt  → collect up to 5 shape_ids per route_id
 *   3. Parse shapes.txt → build coordinate arrays for each needed shape
 *   4. Return one LineString feature per shape, coloured by route
 *
 * The subway route network barely changes, so we cache for 7 days.
 */

const JSZip = require('jszip');

// MTA official colours, keyed by route_id
const ROUTE_COLORS = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C',
  '7': '#B933AD',
  'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6', 'SI': '#0039A6',
  'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M':  '#FF6319',
  'G': '#6CBE45',
  'J': '#996633', 'Z': '#996633',
  'L': '#A7A9AC',
  'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W':  '#FCCC0A',
  'GS': '#808183', 'FS': '#808183', 'H': '#808183',
};

const GTFS_URLS = [
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-gtfs.zip',
  'https://rrgtfsrt.mta.info/nyct/gtfs',
];

// Simple in-process cache so repeated cold starts within the same instance
// don't re-download the ZIP.
let cache = null;
let cacheTs = 0;
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');

  if (cache && Date.now() - cacheTs < CACHE_MS) {
    return res.status(200).json(cache);
  }

  try {
    const geojson = await buildGeoJSON();
    cache  = geojson;
    cacheTs = Date.now();
    return res.status(200).json(geojson);
  } catch (err) {
    console.error('api/lines error:', err.message);
    // Return an empty collection so the map layer just stays invisible
    // rather than crashing the whole page.
    return res.status(200).json({ type: 'FeatureCollection', features: [], _error: err.message });
  }
};

// ── Core logic ──────────────────────────────────────────────────────────

async function buildGeoJSON() {
  const zip = await downloadZip();

  // ── Step 1: trips.txt → route_id → Set<shape_id> ──────────────────
  const tripsText  = await zip.file('trips.txt').async('text');
  const routeShapes = parseRouteShapes(tripsText);

  // Collect the set of shape_ids we actually need to parse
  const needed = new Set();
  for (const shapes of Object.values(routeShapes)) {
    for (const s of shapes) needed.add(s);
  }

  // ── Step 2: shapes.txt → shape_id → [[lon, lat], …] ───────────────
  const shapesText = await zip.file('shapes.txt').async('text');
  const shapeCoords = parseShapes(shapesText, needed);

  // ── Step 3: Build GeoJSON ──────────────────────────────────────────
  const features = [];
  for (const [routeId, shapeSet] of Object.entries(routeShapes)) {
    const color = ROUTE_COLORS[routeId] || '#555555';
    for (const shapeId of shapeSet) {
      const coords = shapeCoords[shapeId];
      if (!coords || coords.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: simplify(coords) },
        properties: { routeId, color },
      });
    }
  }

  console.log(`Built ${features.length} subway line features`);
  return { type: 'FeatureCollection', features };
}

async function downloadZip() {
  let lastErr;
  for (const url of GTFS_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return await JSZip.loadAsync(buf);
    } catch (e) {
      lastErr = e;
      console.warn(`GTFS URL failed (${url}):`, e.message);
    }
  }
  throw lastErr || new Error('All GTFS URLs failed');
}

// ── Parsers ─────────────────────────────────────────────────────────────

const MAX_SHAPES_PER_ROUTE = 5; // enough to cover main trunk + branches

function parseRouteShapes(text) {
  const lines   = text.split('\n');
  const header  = lines[0].split(',');
  const rIdx    = header.indexOf('route_id');
  const sIdx    = header.indexOf('shape_id');

  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const cols    = lines[i].split(',');
    const routeId = (cols[rIdx] || '').trim();
    const shapeId = (cols[sIdx] || '').trim();
    if (!routeId || !shapeId) continue;
    if (!result[routeId]) result[routeId] = new Set();
    if (result[routeId].size < MAX_SHAPES_PER_ROUTE) {
      result[routeId].add(shapeId);
    }
  }
  return result;
}

function parseShapes(text, needed) {
  const lines  = text.split('\n');
  const header = lines[0].split(',');
  const sidIdx = header.indexOf('shape_id');
  const latIdx = header.indexOf('shape_pt_lat');
  const lonIdx = header.indexOf('shape_pt_lon');
  const seqIdx = header.indexOf('shape_pt_sequence');

  const pts = {}; // shape_id → [{seq, coord}]

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const sid  = (cols[sidIdx] || '').trim();
    if (!needed.has(sid)) continue;

    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    const seq = parseInt(cols[seqIdx], 10) || 0;
    if (isNaN(lat) || isNaN(lon)) continue;

    if (!pts[sid]) pts[sid] = [];
    pts[sid].push({ seq, coord: [lon, lat] });
  }

  // Sort by sequence number and extract coordinate arrays
  const result = {};
  for (const [sid, arr] of Object.entries(pts)) {
    arr.sort((a, b) => a.seq - b.seq);
    result[sid] = arr.map(p => p.coord);
  }
  return result;
}

// Distance-based simplification: skip a point if it's within `tol` degrees
// of the previous kept point. 0.0001° ≈ 11 m — invisible at most zoom levels.
function simplify(coords, tol = 0.0001) {
  if (coords.length <= 2) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const p = out[out.length - 1];
    const c = coords[i];
    const dx = c[0] - p[0], dy = c[1] - p[1];
    if (dx * dx + dy * dy >= tol * tol) out.push(c);
  }
  out.push(coords[coords.length - 1]);
  return out;
}
