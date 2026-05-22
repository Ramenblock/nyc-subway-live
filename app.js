/**
 * app.js — NYC Subway Live
 *
 * This is the main browser-side code. Here's what it does, in order:
 *
 *   1. Initialises a dark Mapbox GL map of New York City
 *   2. Fetches all subway station locations from /api/stops
 *   3. Draws small station dots on the map
 *   4. Starts polling /api/subway every 15 seconds for live train positions
 *   5. Renders each train as a glowing coloured circle, colour-coded to its line
 *   6. Smoothly interpolates train positions between data updates
 *   7. Shows a tooltip when you hover over a train
 *
 * To make this work YOU NEED TO:
 *   - Replace YOUR_MAPBOX_TOKEN_HERE below with your real Mapbox public token
 *   - Set MTA_API_KEY in your Vercel project settings (see README)
 */

// ── Your Mapbox public token ────────────────────────────────────────────
// Get a free one at https://account.mapbox.com → Tokens
// It looks like: pk.eyJ1IjoieW91cm5hbWUiLCJhIjoiY...
const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFyd2FucmFtZW4iLCJhIjoiY21wZ2l4czVmMG4xbDJyb2dzMmFyYjA5OCJ9.QxR5lT7I37MZyDSdhgINBQ';

// ── Official MTA subway line colours ────────────────────────────────────
// These are the exact hex values published in the MTA's brand guidelines.
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
    style: 'mapbox://styles/mapbox/dark-v11', // Mapbox's beautiful dark style
    center: [-73.9734, 40.7282],              // Manhattan, slightly south of midtown
    zoom: 11.2,
    minZoom: 9,
    maxZoom: 18,
    antialias: true,
  });

  // Add zoom controls (the +/- buttons)
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

  map.on('load', onMapLoad);
}

// ── Map loaded — set everything up ─────────────────────────────────────

async function onMapLoad() {
  // Build the map layers first, then load data
  setupMapLayers();
  buildLegend();

  // Load station locations (needed for trains that don't report GPS)
  await loadStops();

  // First data fetch, then repeat every 15 seconds
  await fetchAndUpdateTrains();
  setInterval(fetchAndUpdateTrains, 15000);
}

// ── Map layers ──────────────────────────────────────────────────────────
// Mapbox GL works with "sources" (the data) and "layers" (how to draw it).
// We use GeoJSON sources — a standard format for geographic data.

function setupMapLayers() {
  // ── Station dots ──────────────────────────────────────────────────
  // Small, dim dots showing where stations are
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
  // A soft blurred circle behind each train dot creates the glow effect
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
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.25,
      'circle-blur': 1,
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
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255, 255, 255, 0.85)',
    },
  });

  // ── Train route label ─────────────────────────────────────────────
  // The line letter/number rendered on top of each dot at higher zoom levels
  map.addLayer({
    id: 'trains-label',
    type: 'symbol',
    source: 'trains-source',
    minzoom: 12, // Only show labels when zoomed in enough to read them
    layout: {
      'text-field': ['get', 'route'],
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        12, 7,
        16, 13,
      ],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#ffffff',
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
    const props = e.features[0].properties;
    renderTooltip(props);
  });

  map.on('mouseleave', 'trains-dot', () => {
    map.getCanvas().style.cursor = '';
    document.getElementById('tooltip').classList.add('hidden');
  });
}

// ── Load station data ───────────────────────────────────────────────────

async function loadStops() {
  try {
    const res = await fetch('/api/stops');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stops = await res.json();

    // Render stations on the map now that we have their coordinates
    const features = Object.entries(stops)
      // The data has base IDs ("A27") AND directional IDs ("A27N", "A27S").
      // Only render one dot per station — skip the directional duplicates.
      .filter(([id]) => !/[NS]$/.test(id))
      .map(([id, stop]) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [stop.lon, stop.lat],
        },
        properties: { id, name: stop.name },
      }));

    map.getSource('stops-source').setData({
      type: 'FeatureCollection',
      features,
    });

    console.log(`Loaded ${features.length} stations`);
  } catch (err) {
    console.warn('Could not load station data:', err.message);
    // Non-fatal — trains with GPS will still appear correctly
  }
}

// ── Fetch live train data ───────────────────────────────────────────────

async function fetchAndUpdateTrains() {
  try {
    const res = await fetch('/api/subway');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    // Build a GeoJSON feature for each train that has a known position
    const newFeatures = [];

    for (const vehicle of data.vehicles) {
      let lat = vehicle.lat;
      let lon = vehicle.lon;

      // If no GPS, fall back to the stop's coordinates
      if ((!lat || !lon) && vehicle.stopId) {
        const stop = lookupStop(vehicle.stopId);
        if (stop) { lat = stop.lat; lon = stop.lon; }
      }

      if (!lat || !lon) continue; // Can't place this train — skip it

      const route = vehicle.routeId;
      const color = LINE_COLORS[route] || '#888888';

      newFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
        properties: {
          id:        vehicle.id,
          route,
          color,
          stopId:    vehicle.stopId,
          status:    vehicle.currentStatus,
          stopName:  lookupStop(vehicle.stopId)?.name || vehicle.stopId || '—',
        },
      });
    }

    // Kick off smooth animation from old positions to new positions
    startAnimation(newFeatures);

    // Update the count display
    document.getElementById('train-count').textContent = newFeatures.length;

    // Update the timestamp
    const now = new Date();
    document.getElementById('last-updated').textContent =
      'Updated ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Hide any previous error
    document.getElementById('error-banner').classList.add('hidden');

  } catch (err) {
    console.error('Failed to fetch train data:', err.message);
    showError('Could not load live data. Check your MTA API key in Vercel settings.');
  }
}

// ── Smooth position animation ───────────────────────────────────────────
// When new positions arrive every 15 seconds, instead of jumping trains
// abruptly, we glide them smoothly to their new locations over 10 seconds.

function startAnimation(newFeatures) {
  // Snapshot the current rendered positions as the starting point
  currentFeatures = interpolatedFeatures(
    currentFeatures,
    targetFeatures,
    animationStart ? Math.min((Date.now() - animationStart) / ANIMATION_DURATION, 1) : 1
  );
  targetFeatures  = newFeatures;
  animationStart  = Date.now();

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

  if (t < 1) {
    requestAnimationFrame(animateFrame);
  }
}

/**
 * Blends two sets of features by linearly interpolating coordinates.
 * Trains that appear or disappear are handled gracefully.
 */
function interpolatedFeatures(from, to, t) {
  // Build a lookup of the previous positions by vehicle ID
  const fromMap = {};
  for (const f of from) {
    fromMap[f.properties.id] = f.geometry.coordinates;
  }

  return to.map(feature => {
    const id   = feature.properties.id;
    const prev = fromMap[id];
    const next = feature.geometry.coordinates;

    const coords = prev
      ? [
          lerp(prev[0], next[0], t),
          lerp(prev[1], next[1], t),
        ]
      : next; // New train — just place it directly

    return {
      ...feature,
      geometry: { type: 'Point', coordinates: coords },
    };
  });
}

// Linear interpolation helper
function lerp(a, b, t) { return a + (b - a) * t; }

// Smooth easing (slow-in, slow-out)
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
  'INCOMING_AT':  'Incoming at',
  'STOPPED_AT':   'Stopped at',
  'IN_TRANSIT_TO':'In transit to',
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

  // Keep tooltip on screen
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
  legend.innerHTML = LINE_GROUPS.map(group => `
    <div class="legend-row">
      <div class="legend-swatch" style="
        background: ${group.color};
        box-shadow: 0 0 5px ${group.color}, 0 0 10px ${group.color}55;
      "></div>
      <span>${group.label}</span>
    </div>
  `).join('');
}

// ── Error display ────────────────────────────────────────────────────────

function showError(message) {
  const banner = document.getElementById('error-banner');
  document.getElementById('error-message').textContent = message;
  banner.classList.remove('hidden');
}
