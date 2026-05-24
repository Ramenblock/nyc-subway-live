/**
 * app.js — NYC Subway Live
 *
 * Layers (bottom to top):
 *   lines-layer      — static route paths fetched from NYC Open Data
 *   stops-layer      — station dots
 *   trains-glow      — pulsing halo behind each train
 *   trains-dot       — solid coloured circle
 *   trains-label     — route letter (zoom ≥ 12)
 *   trains-direction — ↑/↓ arrow (zoom ≥ 11)
 *   trains-heat      — heatmap density view (hidden by default, toggle-able)
 */

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFyd2FucmFtZW4iLCJhIjoiY21wZ2l4czVmMG4xbDJyb2dzMmFyYjA5OCJ9.QxR5lT7I37MZyDSdhgINBQ';

// ── Official MTA line colours ────────────────────────────────────────────
const LINE_COLORS = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C', '6X': '#00933C',
  '7': '#B933AD', '7X': '#B933AD',
  'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6',
  'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'FX': '#FF6319', 'M': '#FF6319',
  'G': '#6CBE45',
  'J': '#996633', 'Z': '#996633',
  'L': '#A7A9AC',
  'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
  'S': '#808183', 'GS': '#808183', 'FS': '#808183', 'H': '#808183',
  'SI': '#0039A6',
};

// ── Line groups (legend + filter) ───────────────────────────────────────
const LINE_GROUPS = [
  { id: '123',  label: '1 · 2 · 3',    color: '#EE352E', routes: ['1','2','3']           },
  { id: '456',  label: '4 · 5 · 6',    color: '#00933C', routes: ['4','5','6']           },
  { id: '7',    label: '7',             color: '#B933AD', routes: ['7']                   },
  { id: 'ace',  label: 'A · C · E',    color: '#0039A6', routes: ['A','C','E']           },
  { id: 'bdfm', label: 'B · D · F · M',color: '#FF6319', routes: ['B','D','F','M']       },
  { id: 'g',    label: 'G',             color: '#6CBE45', routes: ['G']                   },
  { id: 'jz',   label: 'J · Z',        color: '#996633', routes: ['J','Z']               },
  { id: 'l',    label: 'L',             color: '#A7A9AC', routes: ['L']                   },
  { id: 'nqrw', label: 'N · Q · R · W',color: '#FCCC0A', routes: ['N','Q','R','W']       },
  { id: 's',    label: 'S Shuttles',   color: '#808183', routes: ['S','GS','FS','H']     },
  { id: 'si',   label: 'Staten Island',color: '#0039A6', routes: ['SI']                  },
];

// ── Historical facts for the info panel ─────────────────────────────────
const LINE_HISTORY = {
  '123': { title: '7th Avenue Line', text: 'Part of NYC\'s first subway, opened 1904. The 1 is the West Side local; the 2 and 3 run express through the Bronx and Brooklyn. Together they carry nearly 700,000 riders a day.' },
  '456': { title: 'Lexington Avenue Line', text: 'The busiest rapid-transit corridor in the Western Hemisphere — over 1.3 million daily riders. The 4 and 5 run express, the 6 runs local, tracing the path of an 1878 elevated railway.' },
  '7':   { title: 'Flushing Line', text: 'Nicknamed "The International Express" for the immigrant communities it threads through in Queens. The Hudson Yards terminus, opened 2015, is NYC\'s newest subway station.' },
  'ace': { title: '8th Avenue Line', text: 'Duke Ellington immortalised it in 1941: "Take the A Train." The A is one of NYC\'s longest routes — 31 miles from Inwood to the Rockaways on the Atlantic Ocean.' },
  'bdfm':{ title: '6th Avenue & Concourse Lines', text: 'The F holds the record as NYC\'s longest route at 37.5 miles. The B and D travel the Grand Concourse — a boulevard modelled on the Champs-Élysées. Built by the city in the 1930s to break the private transit monopoly.' },
  'g':   { title: 'Crosstown Line', text: 'The only line that never touches Manhattan, linking Brooklyn and Queens through former industrial waterfront. Famous for running the shortest trains in the system — 4 cars vs the standard 8 or 10.' },
  'jz':  { title: 'Nassau Street Line', text: 'One of the few remaining elevated lines in NYC, rattling on century-old iron trestles above Jamaica Avenue. The Z runs rush-hours only in a skip-stop pattern, serving stations the J skips.' },
  'l':   { title: 'Canarsie Line', text: 'Runs in a single tunnel from 8th Ave Manhattan to Canarsie Brooklyn. Faced a 15-month closure after Hurricane Sandy flooding, but an innovative repair method avoided a full shutdown.' },
  'nqrw':{ title: 'BMT Broadway Line', text: 'Shares express and local tracks through Midtown before branching across Brooklyn and Queens. The Q travels the 2nd Avenue Subway — NYC\'s first new Manhattan line in 75 years, opened 2017.' },
  's':   { title: 'Shuttle Lines', text: 'Three isolated shuttles: 42nd St (Times Sq ↔ Grand Central), Franklin Ave in Brooklyn, and Rockaway Park in Queens. Each is a remnant of a longer line truncated by decades of service changes.' },
  'si':  { title: 'Staten Island Railway', text: 'The only 24/7, MetroCard-accepting commuter rail in the city. Runs from St. George (connected to Manhattan by free ferry) to Tottenville, tracing the route of the original 1860 Staten Island Railway.' },
};

// ── State ────────────────────────────────────────────────────────────────
let map;
let stops          = {};
let liveTrains     = [];
let targetFeatures = [];
let selectedGroups = new Set();
let heatmapActive  = false;
let activePopup    = null;
// routeId → array of GeoJSON LineString features (for on-track interpolation)
let routeGeometries = {};

// ── Initialise Mapbox ────────────────────────────────────────────────────

if (!MAPBOX_TOKEN || MAPBOX_TOKEN === 'YOUR_MAPBOX_TOKEN_HERE') {
  showError('⚠️ Mapbox token not set.');
} else {
  mapboxgl.accessToken = MAPBOX_TOKEN;
  map = new mapboxgl.Map({
    container: 'map',
    style:     'mapbox://styles/mapbox/dark-v11',
    center:    [-73.9734, 40.7282],
    zoom:      11.2,
    minZoom:   9,
    maxZoom:   18,
    antialias: true,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('load', onMapLoad);
}

// ── Startup ──────────────────────────────────────────────────────────────

async function onMapLoad() {
  setupMapLayers();
  buildLegend();
  startGlowPulse();

  await Promise.all([loadLines(), loadStops()]);
  await fetchAndUpdateTrains();

  setInterval(fetchAndUpdateTrains, 15000);
  setInterval(renderLivePositions, 1000);
}

// ── Map layers ───────────────────────────────────────────────────────────

function setupMapLayers() {
  // Route paths (loaded from NYC Open Data)
  map.addSource('lines-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  // Wide blurred layer underneath — gives each route a glowing tube feel
  map.addLayer({
    id: 'lines-glow', type: 'line', source: 'lines-source',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint:  { 'line-color': ['get', 'color'], 'line-width': 18, 'line-opacity': 0.1, 'line-blur': 5 },
  });
  // Crisp line on top
  map.addLayer({
    id: 'lines-layer', type: 'line', source: 'lines-source',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint:  { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.85 },
  });

  // Station dots
  map.addSource('stops-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'stops-layer', type: 'circle', source: 'stops-source',
    paint: {
      'circle-radius':       ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 4],
      'circle-color':        'rgba(255,255,255,0.15)',
      'circle-stroke-width': 0.5,
      'circle-stroke-color': 'rgba(255,255,255,0.3)',
    },
  });

  // Train source shared by all train layers
  map.addSource('trains-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Glow halo (opacity animated by startGlowPulse)
  map.addLayer({
    id: 'trains-glow', type: 'circle', source: 'trains-source',
    paint: {
      'circle-radius':  ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 24],
      'circle-color':   ['get', 'color'],
      'circle-opacity': 0.2,
      'circle-blur':    1,
    },
  });

  // Core dot
  map.addLayer({
    id: 'trains-dot', type: 'circle', source: 'trains-source',
    paint: {
      'circle-radius':       ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 10],
      'circle-color':        ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.85)',
    },
  });

  // Route letter label (zoom ≥ 12)
  map.addLayer({
    id: 'trains-label', type: 'symbol', source: 'trains-source',
    minzoom: 12,
    layout: {
      'text-field':            ['get', 'route'],
      'text-font':             ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size':             ['interpolate', ['linear'], ['zoom'], 12, 7, 16, 13],
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#fff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 1 },
  });

  // Direction arrow (zoom ≥ 11)
  map.addLayer({
    id: 'trains-direction', type: 'symbol', source: 'trains-source',
    minzoom: 11,
    layout: {
      'text-field':            ['get', 'direction'],
      'text-font':             ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size':             ['interpolate', ['linear'], ['zoom'], 11, 7, 14, 11],
      'text-offset':           [0, -1.5],
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#fff', 'text-opacity': 0.7 },
  });

  // Heatmap — hidden by default, shown via toggleHeatmap()
  map.addLayer({
    id: 'trains-heat', type: 'heatmap', source: 'trains-source',
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight':     1,
      'heatmap-intensity':  ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 4],
      'heatmap-radius':     ['interpolate', ['linear'], ['zoom'], 9, 25, 14, 40],
      'heatmap-opacity':    0.85,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(0,0,0,0)',
        0.15,'rgba(0,57,166,0.6)',    // blue
        0.4, 'rgba(185,51,173,0.75)',  // purple
        0.65,'rgba(238,53,46,0.85)',  // red
        0.85,'rgba(252,204,10,0.95)', // yellow
        1,   'rgba(255,255,255,1)',    // white-hot
      ],
    },
  });

  // Hover tooltip
  map.on('mouseenter', 'trains-dot', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    positionTooltip(e.originalEvent);
    renderTooltip(e.features[0].properties);
    document.getElementById('tooltip').classList.remove('hidden');
  });
  map.on('mousemove',  'trains-dot', (e) => { positionTooltip(e.originalEvent); renderTooltip(e.features[0].properties); });
  map.on('mouseleave', 'trains-dot', () => { map.getCanvas().style.cursor = ''; document.getElementById('tooltip').classList.add('hidden'); });

  // Click a train → popup with next-stop info
  map.on('click', 'trains-dot', (e) => {
    const props  = e.features[0].properties;
    const coords = e.features[0].geometry.coordinates.slice();
    const nowSec = Date.now() / 1000;

    let arrivalText = '—';
    if (props.arrivalTime) {
      const mins = Math.round((props.arrivalTime - nowSec) / 60);
      arrivalText = mins <= 0 ? 'Arriving now' : `${mins} min`;
    }

    const statusLabel = STATUS_LABELS[props.status] || 'Near';

    const html = `
      <div class="train-popup">
        <div class="tp-header">
          <div class="tp-badge" style="background:${props.color}">${props.route}</div>
          <div class="tp-title">${props.direction ? props.direction + ' ' : ''}Line ${props.route}</div>
        </div>
        <div class="tp-row">
          <span class="tp-label">${statusLabel}</span>
          <span class="tp-value">${props.stopName}</span>
        </div>
        <div class="tp-divider"></div>
        <div class="tp-row">
          <span class="tp-label">Next stop</span>
          <span class="tp-value">${props.nextStopName}</span>
        </div>
        <div class="tp-row">
          <span class="tp-label">Arriving in</span>
          <span class="tp-value tp-arrival" style="color:${props.color}">${arrivalText}</span>
        </div>
      </div>
    `;

    if (activePopup) activePopup.remove();
    activePopup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 16, className: 'train-popup-wrap' })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map);
  });
}

// ── Glow pulse animation ─────────────────────────────────────────────────
// Gently oscillates the train halo opacity to give the map a breathing feel.

function startGlowPulse() {
  let t = 0;
  function frame() {
    t += 0.018;
    const opacity = 0.15 + 0.12 * Math.sin(t); // oscillates 0.03 – 0.27
    if (map.getLayer('trains-glow')) {
      map.setPaintProperty('trains-glow', 'circle-opacity', opacity);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ── Load subway route lines ──────────────────────────────────────────────
// Priority:
//   1. /subway-lines.geojson  — static file generated from MTA GTFS shapes.txt
//      (complete, accurate, also used for on-track train interpolation)
//   2. /api/lines             — serverless function (may 404 on Vercel)
//   3. ArcGIS Feature Service — live fallback, but has coverage gaps

async function loadLines() {
  let geojson = null;

  // 1. Static pre-generated GTFS shapes file (best quality)
  try {
    const res = await fetch('/subway-lines.geojson', { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      if (data.features?.length > 0) {
        geojson = data;
        console.log(`[lines] ${geojson.features.length} shapes from /subway-lines.geojson`);
      }
    }
  } catch (_) { /* fall through */ }

  // 2. Serverless /api/lines
  if (!geojson) {
    try {
      const res = await fetch('/api/lines', { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        const data = await res.json();
        if (!data._error && data.features?.length > 0) {
          geojson = data;
          console.log(`[lines] ${geojson.features.length} features from /api/lines`);
        }
      }
    } catch (_) { /* fall through */ }
  }

  // 3. ArcGIS fallback (paginated)
  if (!geojson) {
    const ARCGIS_BASE =
      'https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/Subway_view/FeatureServer/0/query';
    try {
      const allFeatures = [];
      let offset = 0;
      while (true) {
        const params = new URLSearchParams({
          where: '1=1', outFields: 'ROUTE,LINE,SUBWAY_LABEL',
          outSR: '4326', resultOffset: offset, resultRecordCount: 2000, f: 'geojson',
        });
        const res = await fetch(`${ARCGIS_BASE}?${params}`, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const features = data.features || [];
        allFeatures.push(...features);
        console.log(`[lines] ArcGIS offset=${offset} → ${features.length} features`);
        if (!data.exceededTransferLimit || features.length === 0) break;
        offset += 2000;
      }
      if (allFeatures.length === 0) throw new Error('no features');
      geojson = { type: 'FeatureCollection', features: allFeatures };
      console.log(`[lines] ArcGIS total: ${allFeatures.length} segments`);
    } catch (err) {
      console.error('[lines] ArcGIS fallback failed:', err.message);
    }
  }

  // Apply colours and push to map
  if (geojson?.features?.length > 0) {
    for (const f of geojson.features) {
      if (!f.properties.color) f.properties.color = resolveLineColor(f.properties);
    }
    map.getSource('lines-source').setData(geojson);
    buildRouteGeometries(geojson);
  }
}

// ── Build route geometry lookup for on-track interpolation ───────────────
// Called once after lines load. Maps routeId → array of LineString features.

function buildRouteGeometries(geojson) {
  routeGeometries = {};
  for (const f of geojson.features) {
    if (f.geometry?.type !== 'LineString') continue;
    const routeId = f.properties.routeId;
    if (!routeId) continue;
    if (!routeGeometries[routeId]) routeGeometries[routeId] = [];
    routeGeometries[routeId].push(f);
  }
  // Map express variants and shuttles to their parent route shapes
  const aliases = { '6X':'6', '7X':'7', 'FX':'F', 'GS':'S', 'FS':'S', 'H':'S' };
  for (const [alias, base] of Object.entries(aliases)) {
    if (!routeGeometries[alias] && routeGeometries[base]) {
      routeGeometries[alias] = routeGeometries[base];
    }
  }
  const nRoutes = Object.keys(routeGeometries).length;
  const nShapes = Object.values(routeGeometries).reduce((s, a) => s + a.length, 0);
  if (nRoutes > 0) console.log(`[lines] geometry index: ${nRoutes} routes, ${nShapes} shapes`);
}

// ── Pre-compute snap positions for a train ───────────────────────────────
// Called in fetchAndUpdateTrains so the per-second render loop is cheap.
// Fills train.snapLine, train.prevSnapDist, train.nextSnapDist (km along line).

function precomputeSnap(train) {
  train.snapLine = null;
  if (!train.prevStopId || !train.nextStopId) return;
  if (typeof turf === 'undefined') return;

  const lines = routeGeometries[train.routeId];
  if (!lines?.length) return;

  const prev = lookupStop(train.prevStopId);
  const next = lookupStop(train.nextStopId);
  if (!prev || !next) return;

  const prevPt = turf.point([prev.lon, prev.lat]);
  const nextPt = turf.point([next.lon, next.lat]);

  let bestLine = null, bestScore = Infinity;
  for (const line of lines) {
    const d1 = turf.nearestPointOnLine(line, prevPt).properties.dist;
    const d2 = turf.nearestPointOnLine(line, nextPt).properties.dist;
    if (d1 + d2 < bestScore) { bestScore = d1 + d2; bestLine = line; }
  }

  // Discard if both stops are more than ~1.5 km from any known line segment
  if (!bestLine || bestScore > 3.0) return;

  train.snapLine     = bestLine;
  train.prevSnapDist = turf.nearestPointOnLine(bestLine, prevPt).properties.location;
  train.nextSnapDist = turf.nearestPointOnLine(bestLine, nextPt).properties.location;
}

/**
 * Resolves an MTA brand colour from a GeoJSON feature's properties.
 *
 * Handles two data sources:
 *   • ArcGIS Feature Service (primary): ROUTE is an integer code (1–85),
 *     LINE is a text name like "8 Avenue" or "Lexington".
 *   • Our /api/lines GTFS output: routeId is a letter like "A", "1", etc.
 */
function resolveLineColor(props) {
  // ── 1. /api/lines GTFS output (routeId letter) ──────────────────────
  const routeId = (props.routeId || '').trim();
  if (routeId && LINE_COLORS[routeId]) return LINE_COLORS[routeId];

  // ── 2. ArcGIS ROUTE integer code (1–85 coded domain) ────────────────
  // Maps each code to the MTA colour that best represents that segment.
  const ROUTE_CODE_COLORS = {
    // 1 / 2 / 3  (red)
    1:'#EE352E', 2:'#EE352E', 3:'#EE352E', 4:'#EE352E', 5:'#EE352E',
    6:'#EE352E', 7:'#EE352E', 8:'#EE352E', 9:'#EE352E',10:'#EE352E',11:'#EE352E',
    // 4 / 5 / 6  (green)
    12:'#00933C',13:'#00933C',14:'#00933C',15:'#00933C',16:'#00933C',17:'#00933C',
    // 7  (purple)
    18:'#B933AD',19:'#B933AD',
    // A / C / E and shared segments  (blue)
    20:'#0039A6',21:'#0039A6',22:'#0039A6',23:'#0039A6',24:'#0039A6',
    25:'#0039A6',26:'#0039A6',27:'#0039A6',28:'#0039A6',
    41:'#0039A6',42:'#0039A6',43:'#0039A6',44:'#0039A6',45:'#0039A6',
    46:'#0039A6',47:'#0039A6',79:'#0039A6',
    // B / D / F / M and shared segments  (orange)
    29:'#FF6319',30:'#FF6319',31:'#FF6319',32:'#FF6319',33:'#FF6319',
    34:'#FF6319',35:'#FF6319',36:'#FF6319',37:'#FF6319',38:'#FF6319',
    39:'#FF6319',40:'#FF6319',48:'#FF6319',50:'#FF6319',51:'#FF6319',
    59:'#FF6319',60:'#FF6319',71:'#FF6319',74:'#FF6319',75:'#FF6319',
    76:'#FF6319',77:'#FF6319',78:'#FF6319',80:'#FF6319',82:'#FF6319',
    83:'#FF6319',84:'#FF6319',85:'#FF6319',
    // G  (light green)
    49:'#6CBE45',52:'#6CBE45',53:'#6CBE45',
    // J / Z  (brown)
    54:'#996633',55:'#996633',56:'#996633',57:'#996633',
    // L  (grey)
    58:'#A7A9AC',
    // N / Q / R / W  (yellow)
    61:'#FCCC0A',62:'#FCCC0A',63:'#FCCC0A',64:'#FCCC0A',65:'#FCCC0A',
    66:'#FCCC0A',67:'#FCCC0A',68:'#FCCC0A',
    // S shuttles  (grey)
    69:'#808183',72:'#808183',73:'#808183',
    // Staten Island Railway  (blue)
    70:'#0039A6',
  };

  const routeCode = props.ROUTE ?? props.route_code;
  if (routeCode != null) {
    const c = ROUTE_CODE_COLORS[Number(routeCode)];
    if (c) return c;
  }

  // ── 3. Name-based matching (ArcGIS LINE / SUBWAY_LABEL) ─────────────
  const name = (props.LINE || props.SUBWAY_LABEL || props.name || props.NAME || '').toLowerCase();
  if (!name) return '#888899';

  if (name.includes('8 av') || name.includes('eighth') ||
      name.includes('fulton') || name.includes('rockaway'))           return '#0039A6';
  if (name.includes('6 av') || name.includes('sixth') ||
      name.includes('concourse') || name.includes('culver') ||
      name.includes('brighton'))                                       return '#FF6319';
  if (name.includes('crosstown'))                                      return '#6CBE45';
  if (name.includes('nassau') || name.includes('jamaica'))             return '#996633';
  if (name.includes('canarsie'))                                       return '#A7A9AC';
  if (name.includes('flushing'))                                       return '#B933AD';
  if (name.includes('broadway') &&
      !name.includes('7th') && !name.includes('seventh'))             return '#FCCC0A';
  if (name.includes('7th') || name.includes('seventh') ||
      name.includes('7 av'))                                           return '#EE352E';
  if (name.includes('lexington'))                                      return '#00933C';
  if (name.includes('staten island') || name.includes('sir'))          return '#0039A6';
  if (name.includes('shuttle') || name.includes('42 st'))              return '#808183';

  return '#888899'; // unknown — faintly visible fallback
}

// ── Load station coordinates ─────────────────────────────────────────────

async function loadStops() {
  try {
    const res = await fetch('/api/stops');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stops = await res.json();

    const features = Object.entries(stops)
      .filter(([id]) => !/[NS]$/.test(id))
      .map(([id, s]) => ({
        type: 'Feature',
        geometry:   { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { id, name: s.name },
      }));

    map.getSource('stops-source').setData({ type: 'FeatureCollection', features });
    console.log(`Loaded ${features.length} stations`);
  } catch (err) {
    console.warn('Could not load station data:', err.message);
  }
}

// ── Fetch live train data (every 15 s) ──────────────────────────────────

async function fetchAndUpdateTrains() {
  try {
    const res = await fetch('/api/subway');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const trains = [];
    for (const v of data.vehicles) {
      let lat = v.lat, lon = v.lon;
      if ((!lat || !lon) && v.stopId) {
        const s = lookupStop(v.stopId);
        if (s) { lat = s.lat; lon = s.lon; }
      }
      if (!lat || !lon) continue;

      trains.push({
        id:            v.id,
        routeId:       v.routeId,
        color:         LINE_COLORS[v.routeId] || '#888888',
        stopId:        v.stopId        || '',
        currentStatus: v.currentStatus,
        lat, lon,
        prevStopId:    v.prevStopId    || null,
        nextStopId:    v.nextStopId    || null,
        departureTime: v.departureTime || null,
        arrivalTime:   v.arrivalTime   || null,
      });
    }

    // Pre-compute on-track snap positions (expensive Turf work done once per fetch)
    if (typeof turf !== 'undefined' && Object.keys(routeGeometries).length > 0) {
      for (const train of trains) precomputeSnap(train);
    }

    liveTrains = trains;
    renderLivePositions();

    document.getElementById('train-count').textContent = trains.length;
    const now = new Date();
    document.getElementById('last-updated').textContent =
      'Updated ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('error-banner').classList.add('hidden');

    if (selectedGroups.size > 0) updateInfoPanel();
  } catch (err) {
    console.error('Failed to fetch train data:', err.message);
    showError('Could not load live data. Retrying shortly…');
  }
}

// ── Live position rendering (every 1 s) ──────────────────────────────────

function renderLivePositions() {
  const nowSec  = Date.now() / 1000;
  const features = [];

  for (const train of liveTrains) {
    let lat = train.lat, lon = train.lon;

    // Schedule-based interpolation between stops
    if (train.prevStopId && train.nextStopId && train.departureTime && train.arrivalTime) {
      const dur = train.arrivalTime - train.departureTime;
      if (dur > 0 && dur < 600) {
        const t = Math.max(0, Math.min(1, (nowSec - train.departureTime) / dur));

        if (train.snapLine && typeof turf !== 'undefined') {
          // On-track interpolation: move the dot along actual route geometry
          const lineLen  = turf.length(train.snapLine);          // km
          const dist     = train.prevSnapDist + (train.nextSnapDist - train.prevSnapDist) * t;
          const clamped  = Math.max(0, Math.min(lineLen, dist));
          const pt       = turf.along(train.snapLine, clamped);
          lon = pt.geometry.coordinates[0];
          lat = pt.geometry.coordinates[1];
        } else {
          // Fallback: straight-line lerp until geometry is loaded
          const prev = lookupStop(train.prevStopId);
          const next = lookupStop(train.nextStopId);
          if (prev && next) {
            lat = lerp(prev.lat, next.lat, t);
            lon = lerp(prev.lon, next.lon, t);
          }
        }
      }
    }

    if (!lat || !lon) continue;

    const sid       = train.stopId || '';
    const direction = sid.endsWith('N') ? '↑' : sid.endsWith('S') ? '↓' : '';

    features.push({
      type: 'Feature',
      geometry:   { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id:          train.id,
        route:       train.routeId,
        color:       train.color,
        stopId:      train.stopId,
        status:      train.currentStatus,
        stopName:    lookupStop(train.stopId)?.name || train.stopId || '—',
        direction,
        nextStopId:  train.nextStopId  || '',
        nextStopName: (train.nextStopId && lookupStop(train.nextStopId)?.name) || '—',
        arrivalTime: train.arrivalTime || 0,
      },
    });
  }

  targetFeatures = features;

  if (map.getSource('trains-source')) {
    map.getSource('trains-source').setData({ type: 'FeatureCollection', features });
  }
}

// ── Heatmap toggle ────────────────────────────────────────────────────────

function toggleHeatmap() {
  heatmapActive = !heatmapActive;

  const trainLayers = ['trains-glow', 'trains-dot', 'trains-label', 'trains-direction'];
  const vis = heatmapActive ? 'none' : 'visible';
  trainLayers.forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  });
  if (map.getLayer('trains-heat')) {
    map.setLayoutProperty('trains-heat', 'visibility', heatmapActive ? 'visible' : 'none');
  }

  const btn = document.getElementById('heatmap-btn');
  btn.classList.toggle('active', heatmapActive);
  btn.textContent = heatmapActive ? '● Heat' : '◌ Heat';
}

// ── Helpers ──────────────────────────────────────────────────────────────

function lookupStop(stopId) {
  if (!stopId) return null;
  return stops[stopId] || stops[stopId.replace(/[NS]$/, '')] || null;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ── Tooltip ──────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  0: 'Incoming at', 1: 'Stopped at', 2: 'In transit to',
  'INCOMING_AT': 'Incoming at', 'STOPPED_AT': 'Stopped at', 'IN_TRANSIT_TO': 'In transit to',
};

function renderTooltip(props) {
  document.getElementById('tooltip-line').textContent  = `Line ${props.route}`;
  document.getElementById('tooltip-line').style.color  = props.color;
  document.getElementById('tooltip-status').textContent = STATUS_LABELS[props.status] || 'Near';
  document.getElementById('tooltip-stop').textContent  = props.stopName;
}

function positionTooltip(e) {
  const tip  = document.getElementById('tooltip');
  const rect = tip.getBoundingClientRect();
  tip.style.left = ((e.clientX + 14 + rect.width > window.innerWidth)  ? e.clientX - rect.width - 10 : e.clientX + 14) + 'px';
  tip.style.top  = ((e.clientY - 10 + rect.height > window.innerHeight) ? e.clientY - rect.height     : e.clientY - 10)  + 'px';
}

// ── Legend ───────────────────────────────────────────────────────────────

function buildLegend() {
  const legend = document.getElementById('legend');

  legend.innerHTML = LINE_GROUPS.map((g, i) => `
    <div class="legend-row" data-index="${i}">
      <div class="legend-swatch" style="background:${g.color}; box-shadow:0 0 5px ${g.color},0 0 10px ${g.color}55;"></div>
      <span>${g.label}</span>
    </div>
  `).join('');

  legend.querySelectorAll('.legend-row').forEach((row, i) => {
    row.addEventListener('click', () => toggleGroup(LINE_GROUPS[i]));
  });

  document.getElementById('line-info-close').addEventListener('click', clearSelection);
  document.getElementById('refresh-btn').addEventListener('click',  fetchAndUpdateTrains);
  document.getElementById('heatmap-btn').addEventListener('click',  toggleHeatmap);
}

// ── Line selection (multi-select) ────────────────────────────────────────

function toggleGroup(group) {
  if (selectedGroups.has(group)) selectedGroups.delete(group);
  else                           selectedGroups.add(group);
  updateLegendState();
  updateMapFilters();
  updateInfoPanel();
}

function clearSelection() {
  selectedGroups.clear();
  updateLegendState();
  updateMapFilters();
  updateInfoPanel();
}

function updateLegendState() {
  document.querySelectorAll('.legend-row').forEach((row, i) => {
    const g = LINE_GROUPS[i];
    row.classList.toggle('active', selectedGroups.has(g));
    row.classList.toggle('dimmed', selectedGroups.size > 0 && !selectedGroups.has(g));
  });
}

function updateMapFilters() {
  const layerIds = ['trains-dot', 'trains-glow', 'trains-label', 'trains-direction'];

  if (selectedGroups.size > 0) {
    const allRoutes = [...selectedGroups].flatMap(g => g.routes);
    const f         = ['in', ['get', 'route'], ['literal', allRoutes]];
    layerIds.forEach(id => map.setFilter(id, f));

    const selColors = [...new Set([...selectedGroups].map(g => g.color))];
    map.setPaintProperty('lines-layer', 'line-opacity', ['case', ['in', ['get', 'color'], ['literal', selColors]], 0.95, 0.05]);
    map.setPaintProperty('lines-layer', 'line-width',   ['case', ['in', ['get', 'color'], ['literal', selColors]], 4.5,  1  ]);
    map.setPaintProperty('lines-glow',  'line-opacity', ['case', ['in', ['get', 'color'], ['literal', selColors]], 0.18, 0.02]);
    map.setPaintProperty('lines-glow',  'line-width',   ['case', ['in', ['get', 'color'], ['literal', selColors]], 22,   6  ]);
  } else {
    layerIds.forEach(id => map.setFilter(id, null));
    map.setPaintProperty('lines-layer', 'line-opacity', 0.85);
    map.setPaintProperty('lines-layer', 'line-width',   3.5);
    map.setPaintProperty('lines-glow',  'line-opacity', 0.1);
    map.setPaintProperty('lines-glow',  'line-width',   18);
  }
}

function updateInfoPanel() {
  const panel = document.getElementById('line-info');
  if (selectedGroups.size === 0) { panel.classList.add('hidden'); return; }

  const allRoutes  = [...selectedGroups].flatMap(g => g.routes);
  const trains     = targetFeatures.filter(f => allRoutes.includes(f.properties.route));
  const northbound = trains.filter(f => (f.properties.stopId || '').endsWith('N')).length;
  const southbound = trains.filter(f => (f.properties.stopId || '').endsWith('S')).length;
  const groups     = [...selectedGroups];

  const nameEl = document.getElementById('line-info-name');
  nameEl.textContent = groups.map(g => g.label).join(' + ');
  nameEl.style.color = groups.length === 1 ? groups[0].color : 'rgba(255,255,255,0.9)';

  document.getElementById('line-info-count').textContent = trains.length;
  document.getElementById('line-info-north').textContent = northbound;
  document.getElementById('line-info-south').textContent = southbound;

  const histEl = document.getElementById('line-history');
  if (groups.length === 1) {
    const hist = LINE_HISTORY[groups[0].id];
    if (hist) {
      document.getElementById('line-history-title').textContent = hist.title;
      document.getElementById('line-history-text').textContent  = hist.text;
      histEl.classList.remove('hidden');
    } else { histEl.classList.add('hidden'); }
  } else { histEl.classList.add('hidden'); }

  panel.classList.remove('hidden');
}

// ── Error display ────────────────────────────────────────────────────────

function showError(msg) {
  document.getElementById('error-message').textContent = msg;
  document.getElementById('error-banner').classList.remove('hidden');
}
