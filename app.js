/**
 * app.js — NYC Subway Live
 *
 * What this file does:
 *   1.  Initialises a Mapbox dark map of New York City
 *   2.  Draws subway route lines from /api/lines
 *   3.  Draws station dots from /api/stops
 *   4.  Polls /api/subway every 15 s for live train + schedule data
 *   5.  Every 1 s, re-computes each train's position by interpolating
 *       between its previous and next stop using the MTA schedule times
 *       → trains move smoothly across the map in real time
 *   6.  Shows ↑/↓ direction arrows on each dot
 *   7.  Interactive legend — click one or more line groups to filter;
 *       an info panel shows live counts + historical facts per line
 *   8.  Manual refresh button
 */

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFyd2FucmFtZW4iLCJhIjoiY21wZ2l4czVmMG4xbDJyb2dzMmFyYjA5OCJ9.QxR5lT7I37MZyDSdhgINBQ';

// ── Official MTA line colours ────────────────────────────────────────────
const LINE_COLORS = {
  '1':  '#EE352E', '2':  '#EE352E', '3':  '#EE352E',
  '4':  '#00933C', '5':  '#00933C', '6':  '#00933C', '6X': '#00933C',
  '7':  '#B933AD', '7X': '#B933AD',
  'A':  '#0039A6', 'C':  '#0039A6', 'E':  '#0039A6',
  'B':  '#FF6319', 'D':  '#FF6319', 'F':  '#FF6319', 'FX': '#FF6319', 'M': '#FF6319',
  'G':  '#6CBE45',
  'J':  '#996633', 'Z':  '#996633',
  'L':  '#A7A9AC',
  'N':  '#FCCC0A', 'Q':  '#FCCC0A', 'R':  '#FCCC0A', 'W': '#FCCC0A',
  'S':  '#808183', 'GS': '#808183', 'FS': '#808183', 'H': '#808183',
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

// ── Historical facts shown in the info panel ─────────────────────────────
const LINE_HISTORY = {
  '123': {
    title: '7th Avenue Line',
    text: 'Part of New York\'s first subway, opened 1904. The 1 is the West Side local; the 2 and 3 run express on the same tracks through the Bronx and Brooklyn. Together they carry nearly 700,000 riders a day.',
  },
  '456': {
    title: 'Lexington Avenue Line',
    text: 'The busiest rapid-transit corridor in the Western Hemisphere — over 1.3 million daily riders. The 4 and 5 run express while the 6 runs local. The tracks follow the path of an 1878 elevated railway.',
  },
  '7': {
    title: 'Flushing Line',
    text: 'Nicknamed "The International Express" by the White House in 1999 for the dozens of immigrant communities it threads through Queens. The western terminus at Hudson Yards, opened 2015, is NYC\'s newest subway station.',
  },
  'ace': {
    title: '8th Avenue Line',
    text: 'Duke Ellington immortalised it in 1941: "Take the A Train." The A is one of NYC\'s longest routes — from Inwood in upper Manhattan to the Rockaways on the Atlantic, 31 miles end to end.',
  },
  'bdfm': {
    title: '6th Avenue & Concourse Lines',
    text: 'The F holds the record as NYC\'s longest single route at 37.5 miles. The B and D travel the Grand Concourse in the Bronx — a boulevard modelled on the Champs-Élysées. These IND lines were built by the city in the 1930s to break the private transit monopoly.',
  },
  'g': {
    title: 'Crosstown Line',
    text: 'The only line that never touches Manhattan, linking Brooklyn and Queens through what was once industrial waterfront. Famous for running the shortest trains in the system — 4 cars versus the standard 8 or 10.',
  },
  'jz': {
    title: 'Nassau Street Line',
    text: 'One of the few remaining elevated lines in NYC, rattling on century-old iron trestles above Jamaica Avenue. The Z runs rush-hours only in a skip-stop pattern, serving stations the J skips — a rare operating style.',
  },
  'l': {
    title: 'Canarsie Line',
    text: 'Runs entirely in a single tunnel between 8th Ave Manhattan and Canarsie Brooklyn. Scheduled for a 15-month shutdown after Hurricane Sandy flooding, but an innovative repair method allowed the work to be done without full closure.',
  },
  'nqrw': {
    title: 'BMT Broadway Line',
    text: 'Shares express and local tracks through Midtown before branching across Brooklyn and Queens. The Q travels the 2nd Avenue Subway — NYC\'s first new Manhattan line in 75 years, opened 2017.',
  },
  's': {
    title: 'Shuttle Lines',
    text: 'Three isolated shuttles: the 42nd St Shuttle (Times Sq ↔ Grand Central), the Franklin Ave Shuttle in Brooklyn, and the Rockaway Park Shuttle in Queens. Each is a remnant of a longer line truncated by service changes over the decades.',
  },
  'si': {
    title: 'Staten Island Railway',
    text: 'The only 24/7, above-ground, MetroCard-accepting commuter rail in the city. Runs from St. George terminal (connected to Manhattan by free ferry) to Tottenville, tracing the route of the original 1860 Staten Island Railway.',
  },
};

// ── State ────────────────────────────────────────────────────────────────
let map;
let stops       = {};      // stop_id → { name, lat, lon }
let liveTrains  = [];      // latest processed train objects
let targetFeatures = [];   // GeoJSON features from last render (for stats)
let selectedGroups = new Set(); // currently selected LINE_GROUPS entries

// ── Initialise Mapbox ────────────────────────────────────────────────────

if (!MAPBOX_TOKEN || MAPBOX_TOKEN === 'YOUR_MAPBOX_TOKEN_HERE') {
  showError('⚠️ Mapbox token not set. Open app.js and replace the placeholder.');
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

// ── Startup sequence ─────────────────────────────────────────────────────

async function onMapLoad() {
  setupMapLayers();
  buildLegend();

  // Load static data and first live snapshot in parallel
  await Promise.all([loadLines(), loadStops()]);
  await fetchAndUpdateTrains();

  // Poll for new data every 15 s
  setInterval(fetchAndUpdateTrains, 15000);

  // Re-render positions every 1 s using schedule interpolation
  setInterval(renderLivePositions, 1000);
}

// ── Map layers ───────────────────────────────────────────────────────────

function setupMapLayers() {
  // Route lines — drawn first so trains sit on top
  map.addSource('lines-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'lines-layer', type: 'line', source: 'lines-source',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint:  { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.4 },
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

  // Train source (shared by all train layers)
  map.addSource('trains-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Glow halo
  map.addLayer({
    id: 'trains-glow', type: 'circle', source: 'trains-source',
    paint: {
      'circle-radius':  ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 22],
      'circle-color':   ['get', 'color'],
      'circle-opacity': 0.25,
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

  // Route letter label (zoom 12+)
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
    paint: {
      'text-color':      '#ffffff',
      'text-halo-color': ['get', 'color'],
      'text-halo-width': 1,
    },
  });

  // Direction arrow above each dot (zoom 11+)
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
    paint: {
      'text-color':   '#ffffff',
      'text-opacity': 0.7,
    },
  });

  // Hover tooltip
  map.on('mouseenter', 'trains-dot', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    positionTooltip(e.originalEvent);
    renderTooltip(e.features[0].properties);
    document.getElementById('tooltip').classList.remove('hidden');
  });
  map.on('mousemove', 'trains-dot', (e) => {
    positionTooltip(e.originalEvent);
    renderTooltip(e.features[0].properties);
  });
  map.on('mouseleave', 'trains-dot', () => {
    map.getCanvas().style.cursor = '';
    document.getElementById('tooltip').classList.add('hidden');
  });
}

// ── Load subway route lines ──────────────────────────────────────────────

async function loadLines() {
  try {
    const res = await fetch('/api/lines');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    if (geojson._error) console.warn('Lines API warning:', geojson._error);
    map.getSource('lines-source').setData(geojson);
    console.log(`Loaded ${geojson.features?.length || 0} subway line segments`);
  } catch (err) {
    console.warn('Could not load subway lines:', err.message);
  }
}

// ── Load station coordinates ─────────────────────────────────────────────

async function loadStops() {
  try {
    const res = await fetch('/api/stops');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stops = await res.json();

    const features = Object.entries(stops)
      .filter(([id]) => !/[NS]$/.test(id))
      .map(([id, stop]) => ({
        type: 'Feature',
        geometry:   { type: 'Point', coordinates: [stop.lon, stop.lat] },
        properties: { id, name: stop.name },
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

    // Build the internal liveTrains array — one object per placeable train
    const trains = [];
    for (const v of data.vehicles) {
      // Resolve fallback position from stop coordinates
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
        stopId:        v.stopId   || '',
        currentStatus: v.currentStatus,
        lat, lon,
        prevStopId:    v.prevStopId    || null,
        nextStopId:    v.nextStopId    || null,
        departureTime: v.departureTime || null,
        arrivalTime:   v.arrivalTime   || null,
      });
    }

    liveTrains = trains;

    // Immediate render so the map updates right away
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
// Uses the schedule data from the API to interpolate each train's position
// between its previous and next stop based on real elapsed time.

function renderLivePositions() {
  const nowSec = Date.now() / 1000; // Unix timestamp in seconds
  const features = [];

  for (const train of liveTrains) {
    let lat = train.lat;
    let lon = train.lon;

    // If we have schedule data, compute interpolated position
    if (train.prevStopId && train.nextStopId && train.departureTime && train.arrivalTime) {
      const duration = train.arrivalTime - train.departureTime;
      if (duration > 0 && duration < 600) { // sanity-check: trip leg < 10 min
        const t = Math.max(0, Math.min(1, (nowSec - train.departureTime) / duration));
        const prev = lookupStop(train.prevStopId);
        const next = lookupStop(train.nextStopId);
        if (prev && next) {
          lat = lerp(prev.lat, next.lat, t);
          lon = lerp(prev.lon, next.lon, t);
        }
      }
    }

    if (!lat || !lon) continue;

    // Derive direction from the stopId suffix (N = northbound, S = southbound)
    const sid = train.stopId || '';
    const direction = sid.endsWith('N') ? '↑' : sid.endsWith('S') ? '↓' : '';

    features.push({
      type: 'Feature',
      geometry:   { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id:        train.id,
        route:     train.routeId,
        color:     train.color,
        stopId:    train.stopId,
        status:    train.currentStatus,
        stopName:  lookupStop(train.stopId)?.name || train.stopId || '—',
        direction,
      },
    });
  }

  targetFeatures = features;

  if (map.getSource('trains-source')) {
    map.getSource('trains-source').setData({ type: 'FeatureCollection', features });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function lookupStop(stopId) {
  if (!stopId) return null;
  return stops[stopId] || stops[stopId.replace(/[NS]$/, '')] || null;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ── Tooltip ──────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  0: 'Incoming at',   1: 'Stopped at',    2: 'In transit to',
  'INCOMING_AT':  'Incoming at',
  'STOPPED_AT':   'Stopped at',
  'IN_TRANSIT_TO':'In transit to',
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
  const left = (e.clientX + 14 + rect.width  > window.innerWidth)
    ? e.clientX - rect.width  - 10 : e.clientX + 14;
  const top  = (e.clientY - 10  + rect.height > window.innerHeight)
    ? e.clientY - rect.height      : e.clientY - 10;
  tip.style.left = left + 'px';
  tip.style.top  = top  + 'px';
}

// ── Legend ───────────────────────────────────────────────────────────────

function buildLegend() {
  const legend = document.getElementById('legend');

  legend.innerHTML = LINE_GROUPS.map((g, i) => `
    <div class="legend-row" data-index="${i}" title="Click to filter (hold to multi-select)">
      <div class="legend-swatch" style="
        background: ${g.color};
        box-shadow: 0 0 5px ${g.color}, 0 0 10px ${g.color}55;
      "></div>
      <span>${g.label}</span>
    </div>
  `).join('');

  legend.querySelectorAll('.legend-row').forEach((row, i) => {
    row.addEventListener('click', () => toggleGroup(LINE_GROUPS[i]));
  });

  document.getElementById('line-info-close').addEventListener('click', clearSelection);
  document.getElementById('refresh-btn').addEventListener('click', () => {
    fetchAndUpdateTrains();
  });
}

// ── Line selection (multi-select) ────────────────────────────────────────

function toggleGroup(group) {
  if (selectedGroups.has(group)) {
    selectedGroups.delete(group);
  } else {
    selectedGroups.add(group);
  }
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
    row.classList.toggle('active',  selectedGroups.has(g));
    row.classList.toggle('dimmed',  selectedGroups.size > 0 && !selectedGroups.has(g));
  });
}

function updateMapFilters() {
  const layerIds = ['trains-dot', 'trains-glow', 'trains-label', 'trains-direction'];

  if (selectedGroups.size > 0) {
    const allRoutes = [...selectedGroups].flatMap(g => g.routes);
    const f = ['in', ['get', 'route'], ['literal', allRoutes]];
    layerIds.forEach(id => map.setFilter(id, f));

    const selColors = [...new Set([...selectedGroups].map(g => g.color))];
    map.setPaintProperty('lines-layer', 'line-opacity', [
      'case', ['in', ['get', 'color'], ['literal', selColors]], 0.9, 0.05,
    ]);
    map.setPaintProperty('lines-layer', 'line-width', [
      'case', ['in', ['get', 'color'], ['literal', selColors]], 3, 1,
    ]);
  } else {
    layerIds.forEach(id => map.setFilter(id, null));
    map.setPaintProperty('lines-layer', 'line-opacity', 0.4);
    map.setPaintProperty('lines-layer', 'line-width',   1.5);
  }
}

function updateInfoPanel() {
  const panel = document.getElementById('line-info');

  if (selectedGroups.size === 0) {
    panel.classList.add('hidden');
    return;
  }

  const allRoutes  = [...selectedGroups].flatMap(g => g.routes);
  const trains     = targetFeatures.filter(f => allRoutes.includes(f.properties.route));
  const northbound = trains.filter(f => (f.properties.stopId || '').endsWith('N')).length;
  const southbound = trains.filter(f => (f.properties.stopId || '').endsWith('S')).length;

  // Name: use first group's label if single selection, otherwise combined
  const nameEl = document.getElementById('line-info-name');
  const groups  = [...selectedGroups];
  nameEl.textContent  = groups.map(g => g.label).join(' + ');
  nameEl.style.color  = groups.length === 1 ? groups[0].color : 'rgba(255,255,255,0.9)';

  document.getElementById('line-info-count').textContent = trains.length;
  document.getElementById('line-info-north').textContent = northbound;
  document.getElementById('line-info-south').textContent = southbound;

  // History: only shown for a single selected group
  const histEl = document.getElementById('line-history');
  if (groups.length === 1) {
    const hist = LINE_HISTORY[groups[0].id];
    if (hist) {
      document.getElementById('line-history-title').textContent = hist.title;
      document.getElementById('line-history-text').textContent  = hist.text;
      histEl.classList.remove('hidden');
    } else {
      histEl.classList.add('hidden');
    }
  } else {
    histEl.classList.add('hidden');
  }

  panel.classList.remove('hidden');
}

// ── Error display ────────────────────────────────────────────────────────

function showError(message) {
  document.getElementById('error-message').textContent = message;
  document.getElementById('error-banner').classList.remove('hidden');
}
