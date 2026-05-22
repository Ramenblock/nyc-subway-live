/**
 * app.js — NYC Subway Live
 *
 * This is the main browser-side code. Here's what it does, in order:
 *
 *   1. Initialises a dark Mapbox GL map of New York City
 *   2. Loads subway line paths from /api/lines and draws them on the map
 *   3. Fetches all subway station locations from /api/stops
 *   4. Draws small station dots on the map
 *   5. Starts polling /api/subway every 15 seconds for live train positions
 *   6. Renders each train as a glowing coloured circle, colour-coded to its line
 *   7. Smoothly interpolates train positions between data updates
 *      (snaps instead of animating when a train jumps to a new stop)
 *   8. Shows a tooltip when you hover over a train
 *   9. Interactive legend — click any line group to filter the map and see stats
 */

// ── Your Mapbox public token ────────────────────────────────────────────
const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFyd2FucmFtZW4iLCJhIjoiY21wZ2l4czVmMG4xbDJyb2dzMmFyYjA5OCJ9.QxR5lT7I37MZyDSdhgINBQ';

// ── Official MTA subway line colours ────────────────────────────────────
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

// Line groups shown in the legend (combining lines that share a colour)
const LINE_GROUPS = [
  { label: '1 · 2 · 3',    color: '#EE352E', routes: ['1','2','3']           },
  { label: '4 · 5 · 6',    color: '#00933C', routes: ['4','5','6']           },
  { label: '7',             color: '#B933AD', routes: ['7']                   },
  { label: 'A · C · E',    color: '#0039A6', routes: ['A','C','E']           },
  { label: 'B · D · F · M',color: '#FF6319', routes: ['B','D','F','M']       },
  { label: 'G',             color: '#6CBE45', routes: ['G']                   },
  { label: 'J · Z',        color: '#996633', routes: ['J','Z']               },
  { label: 'L',             color: '#A7A9AC', routes: ['L']                   },
  { label: 'N · Q · R · W',color: '#FCCC0A', routes: ['N','Q','R','W']       },
  { label: 'S Shuttles',   color: '#808183', routes: ['S','GS','FS','H']     },
  { label: 'Staten Island',color: '#0039A6', routes: ['SI']                  },
];

// ── State ───────────────────────────────────────────────────────────────
let map;                  // The Mapbox GL map instance
let stops = {};           // station lookup: stop_id → { name, lat, lon }
let currentFeatures = []; // the most recent list of train features for animation
let targetFeatures  = []; // the features we're animating towards
let animationStart  = null;
let selectedGroup   = null; // the currently selected LINE_GROUPS entry (or null = show all)
const ANIMATION_DURATION = 10000; // 10 seconds to slide to new positions

// ── Initialise Mapbox ───────────────────────────────────────────────────

if (!MAPBOX_TOKEN || MAPBOX_TOKEN === 'YOUR_MAPBOX_TOKEN_HERE') {
  showError(
    '⚠️ Mapbox token not set. Open app.js and replace YOUR_MAPBOX_TOKEN_HERE with your token.'
  );
} else {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-73.9734, 40.7282],
    zoom: 11.2,
    minZoom: 9,
    maxZoom: 18,
    antialias: true,
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('load', onMapLoad);
}

// ── Map loaded — set everything up ─────────────────────────────────────

async function onMapLoad() {
  setupMapLayers();
  buildLegend();

  // Load subway line paths, station locations, then live train data
  await Promise.all([loadLines(), loadStops()]);

  await fetchAndUpdateTrains();
  setInterval(fetchAndUpdateTrains, 15000);
}

// ── Map layers ──────────────────────────────────────────────────────────

function setupMapLayers() {
  // ── Subway route lines ────────────────────────────────────────────
  // These are the actual track paths, drawn before everything else so
  // train dots sit on top of them.
  map.addSource('lines-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'lines-layer',
    type: 'line',
    source: 'lines-source',
    layout: {
      'line-join': 'round',
      'line-cap':  'round',
    },
    paint: {
      'line-color':   ['get', 'color'],
      'line-width':   1.5,
      'line-opacity': 0.4,
    },
  });

  // ── Station dots ──────────────────────────────────────────────────
  map.addSource('stops-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'stops-layer',
    type: 'circle',
    source: 'stops-source',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        9, 1.5,
        14, 4,
      ],
      'circle-color': 'rgba(255, 255, 255, 0.15)',
      'circle-stroke-width': 0.5,
      'circle-stroke-color': 'rgba(255, 255, 255, 0.3)',
    },
  });

  // ── Train glow (outer halo) ───────────────────────────────────────
  map.addSource('trains-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'trains-glow',
    type: 'circle',
    source: 'trains-source',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        9, 10,
        14, 22,
      ],
      'circle-color':   ['get', 'color'],
      'circle-opacity': 0.25,
      'circle-blur':    1,
    },
  });

  // ── Train core dot ────────────────────────────────────────────────
  map.addLayer({
    id: 'trains-dot',
    type: 'circle',
    source: 'trains-source',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        9, 4,
        14, 10,
      ],
      'circle-color':        ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255, 255, 255, 0.85)',
    },
  });

  // ── Train route label ─────────────────────────────────────────────
  map.addLayer({
    id: 'trains-label',
    type: 'symbol',
    source: 'trains-source',
    minzoom: 12,
    layout: {
      'text-field':            ['get', 'route'],
      'text-font':             ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        12, 7,
        16, 13,
      ],
      'text-allow-overlap':    true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color':      '#ffffff',
      'text-halo-color': ['get', 'color'],
      'text-halo-width': 1,
    },
  });

  // ── Hover interactions ────────────────────────────────────────────
  map.on('mouseenter', 'trains-dot', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const props = e.features[0].properties;
    positionTooltip(e.originalEvent);
    renderTooltip(props);
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

// ── Load subway line paths ──────────────────────────────────────────────

async function loadLines() {
  try {
    const res = await fetch('/api/lines');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    if (geojson.error) throw new Error(geojson.error);

    map.getSource('lines-source').setData(geojson);
    console.log(`Loaded ${geojson.features?.length || 0} subway line segments`);
  } catch (err) {
    console.warn('Could not load subway lines:', err.message);
    // Non-fatal — the map still shows trains without the route paths
  }
}

// ── Load station data ───────────────────────────────────────────────────

async function loadStops() {
  try {
    const res = await fetch('/api/stops');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stops = await res.json();

    const features = Object.entries(stops)
      .filter(([id]) => !/[NS]$/.test(id))
      .map(([id, stop]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
        properties: { id, name: stop.name },
      }));

    map.getSource('stops-source').setData({
      type: 'FeatureCollection',
      features,
    });

    console.log(`Loaded ${features.length} stations`);
  } catch (err) {
    console.warn('Could not load station data:', err.message);
  }
}

// ── Fetch live train data ───────────────────────────────────────────────

async function fetchAndUpdateTrains() {
  try {
    const res = await fetch('/api/subway');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const newFeatures = [];

    for (const vehicle of data.vehicles) {
      let lat = vehicle.lat;
      let lon = vehicle.lon;

      if ((!lat || !lon) && vehicle.stopId) {
        const stop = lookupStop(vehicle.stopId);
        if (stop) { lat = stop.lat; lon = stop.lon; }
      }

      if (!lat || !lon) continue;

      const route = vehicle.routeId;
      const color = LINE_COLORS[route] || '#888888';

      newFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          id:       vehicle.id,
          route,
          color,
          stopId:   vehicle.stopId,
          status:   vehicle.currentStatus,
          stopName: lookupStop(vehicle.stopId)?.name || vehicle.stopId || '—',
        },
      });
    }

    startAnimation(newFeatures);

    document.getElementById('train-count').textContent = newFeatures.length;

    const now = new Date();
    document.getElementById('last-updated').textContent =
      'Updated ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    document.getElementById('error-banner').classList.add('hidden');

    // Refresh info panel counts if a line is selected
    if (selectedGroup) updateInfoPanel();

  } catch (err) {
    console.error('Failed to fetch train data:', err.message);
    showError('Could not load live data. Retrying shortly…');
  }
}

// ── Smooth position animation ───────────────────────────────────────────

function startAnimation(newFeatures) {
  currentFeatures = interpolatedFeatures(
    currentFeatures,
    targetFeatures,
    animationStart ? Math.min((Date.now() - animationStart) / ANIMATION_DURATION, 1) : 1
  );
  targetFeatures = newFeatures;
  animationStart = Date.now();
  requestAnimationFrame(animateFrame);
}

function animateFrame() {
  if (!animationStart) return;

  const t = Math.min((Date.now() - animationStart) / ANIMATION_DURATION, 1);
  const features = interpolatedFeatures(currentFeatures, targetFeatures, easeInOut(t));

  if (map.getSource('trains-source')) {
    map.getSource('trains-source').setData({
      type: 'FeatureCollection',
      features,
    });
  }

  if (t < 1) requestAnimationFrame(animateFrame);
}

/**
 * Blends two sets of features by linearly interpolating coordinates.
 *
 * NYC subway trains mostly lack GPS and are placed at their current stop.
 * When a train advances to the next stop the coordinates jump suddenly —
 * animating that would make the dot fly across the map. We skip the
 * animation for any movement larger than ~2 km and snap instead.
 * Adjacent stops are 0.3–1 km apart, so legitimate smooth motion is well
 * under that threshold.
 */
function interpolatedFeatures(from, to, t) {
  const fromMap = {};
  for (const f of from) {
    fromMap[f.properties.id] = f.geometry.coordinates;
  }

  return to.map(feature => {
    const id   = feature.properties.id;
    const prev = fromMap[id];
    const next = feature.geometry.coordinates;

    let coords = next; // default: snap to new position

    if (prev) {
      const dx = prev[0] - next[0];
      const dy = prev[1] - next[1];
      // 0.0004 ≈ (0.02°)² — a ~2 km diagonal threshold at NYC's latitude
      if (dx * dx + dy * dy < 0.0004) {
        coords = [lerp(prev[0], next[0], t), lerp(prev[1], next[1], t)];
      }
    }

    return {
      ...feature,
      geometry: { type: 'Point', coordinates: coords },
    };
  });
}

function lerp(a, b, t) { return a + (b - a) * t; }

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// ── Stop coordinate lookup ──────────────────────────────────────────────

function lookupStop(stopId) {
  if (!stopId) return null;
  return stops[stopId] || stops[stopId.replace(/[NS]$/, '')] || null;
}

// ── Tooltip ─────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  0: 'Incoming at',
  1: 'Stopped at',
  2: 'In transit to',
  'INCOMING_AT':   'Incoming at',
  'STOPPED_AT':    'Stopped at',
  'IN_TRANSIT_TO': 'In transit to',
};

function renderTooltip(props) {
  document.getElementById('tooltip-line').textContent = `Line ${props.route}`;
  document.getElementById('tooltip-line').style.color = props.color;
  document.getElementById('tooltip-status').textContent = STATUS_LABELS[props.status] || 'Near';
  document.getElementById('tooltip-stop').textContent = props.stopName;
}

function positionTooltip(mouseEvent) {
  const tip  = document.getElementById('tooltip');
  const x    = mouseEvent.clientX;
  const y    = mouseEvent.clientY;
  const rect = tip.getBoundingClientRect();

  const left = (x + 14 + rect.width > window.innerWidth)
    ? x - rect.width - 10
    : x + 14;

  const top = (y - 10 + rect.height > window.innerHeight)
    ? y - rect.height
    : y - 10;

  tip.style.left = left + 'px';
  tip.style.top  = top  + 'px';
}

// ── Legend ──────────────────────────────────────────────────────────────

function buildLegend() {
  const legend = document.getElementById('legend');

  legend.innerHTML = LINE_GROUPS.map((group, i) => `
    <div class="legend-row" data-index="${i}" title="Click to filter">
      <div class="legend-swatch" style="
        background: ${group.color};
        box-shadow: 0 0 5px ${group.color}, 0 0 10px ${group.color}55;
      "></div>
      <span>${group.label}</span>
    </div>
  `).join('');

  legend.querySelectorAll('.legend-row').forEach((row, i) => {
    row.addEventListener('click', () => selectGroup(LINE_GROUPS[i]));
  });

  // Wire up the close button in the info panel
  document.getElementById('line-info-close').addEventListener('click', () => {
    if (selectedGroup) selectGroup(selectedGroup); // toggles off
  });
}

// ── Line selection ──────────────────────────────────────────────────────

function selectGroup(group) {
  // Clicking the same group again deselects it
  selectedGroup = (selectedGroup === group) ? null : group;

  updateLegendState();
  updateMapFilters();
  updateInfoPanel();
}

function updateLegendState() {
  document.querySelectorAll('.legend-row').forEach((row, i) => {
    const group = LINE_GROUPS[i];
    row.classList.toggle('active',  group === selectedGroup);
    row.classList.toggle('dimmed',  selectedGroup !== null && group !== selectedGroup);
  });
}

function updateMapFilters() {
  if (selectedGroup) {
    const routeFilter = ['in', ['get', 'route'], ['literal', selectedGroup.routes]];
    map.setFilter('trains-dot',   routeFilter);
    map.setFilter('trains-glow',  routeFilter);
    map.setFilter('trains-label', routeFilter);

    // Highlight selected line paths, fade everything else
    map.setPaintProperty('lines-layer', 'line-opacity', [
      'case',
      ['==', ['get', 'color'], selectedGroup.color], 0.9,
      0.05,
    ]);
    map.setPaintProperty('lines-layer', 'line-width', [
      'case',
      ['==', ['get', 'color'], selectedGroup.color], 3,
      1,
    ]);
  } else {
    // Show everything
    map.setFilter('trains-dot',   null);
    map.setFilter('trains-glow',  null);
    map.setFilter('trains-label', null);

    map.setPaintProperty('lines-layer', 'line-opacity', 0.4);
    map.setPaintProperty('lines-layer', 'line-width',   1.5);
  }
}

function updateInfoPanel() {
  const panel = document.getElementById('line-info');

  if (!selectedGroup) {
    panel.classList.add('hidden');
    return;
  }

  // Count trains that belong to this line group
  const groupTrains = targetFeatures.filter(f =>
    selectedGroup.routes.includes(f.properties.route)
  );

  // Northbound = stopId ends in "N", southbound = "S"
  const northbound = groupTrains.filter(f => (f.properties.stopId || '').endsWith('N')).length;
  const southbound = groupTrains.filter(f => (f.properties.stopId || '').endsWith('S')).length;

  document.getElementById('line-info-name').textContent  = selectedGroup.label;
  document.getElementById('line-info-name').style.color  = selectedGroup.color;
  document.getElementById('line-info-count').textContent = groupTrains.length;
  document.getElementById('line-info-north').textContent = northbound;
  document.getElementById('line-info-south').textContent = southbound;

  panel.classList.remove('hidden');
}

// ── Error display ────────────────────────────────────────────────────────

function showError(message) {
  const banner = document.getElementById('error-banner');
  document.getElementById('error-message').textContent = message;
  banner.classList.remove('hidden');
}
