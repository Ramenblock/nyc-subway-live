#!/usr/bin/env python3
"""
scripts/generate-lines.py
=========================
Downloads the MTA NYC Subway GTFS static feed and produces
subway-lines.geojson at the project root.

Run once from the project root:
    python3 scripts/generate-lines.py

Then commit subway-lines.geojson to your repo and push to GitHub.
Vercel will serve it as a static asset at /subway-lines.geojson.

The file is used by app.js for two things:
  1. Drawing complete, gap-free route lines on the map
  2. Snapping train markers to actual track geometry (on-track interpolation)
"""

import json, zipfile, io, urllib.request, os, csv
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────────
GTFS_URL = 'http://web.mta.info/developers/data/nyct/subway/google_transit.zip'
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'subway-lines.geojson')

# Official MTA brand colours — must match LINE_COLORS in app.js
LINE_COLORS = {
    '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
    '4': '#00933C', '5': '#00933C', '6': '#00933C', '6X': '#00933C',
    '7': '#B933AD', '7X': '#B933AD',
    'A': '#0039A6', 'C': '#0039A6', 'E':  '#0039A6',
    'B': '#FF6319', 'D': '#FF6319', 'F':  '#FF6319', 'FX': '#FF6319', 'M': '#FF6319',
    'G': '#6CBE45',
    'J': '#996633', 'Z': '#996633',
    'L': '#A7A9AC',
    'N': '#FCCC0A', 'Q': '#FCCC0A', 'R':  '#FCCC0A', 'W': '#FCCC0A',
    'S': '#808183', 'GS': '#808183', 'FS': '#808183', 'H': '#808183',
    'SI': '#0039A6',
}

# ── Download ────────────────────────────────────────────────────────────────
print(f'Downloading GTFS from:\n  {GTFS_URL}\n')
req = urllib.request.Request(GTFS_URL, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=60) as resp:
    raw = resp.read()
print(f'Downloaded {len(raw):,} bytes. Extracting...')

# ── Parse ───────────────────────────────────────────────────────────────────
with zipfile.ZipFile(io.BytesIO(raw)) as z:
    shapes_csv = z.read('shapes.txt').decode('utf-8-sig')
    trips_csv  = z.read('trips.txt').decode('utf-8-sig')

# trips.txt: build shape_id → set of route_ids
shape_to_routes = defaultdict(set)
for row in csv.DictReader(io.StringIO(trips_csv)):
    shape_to_routes[row['shape_id'].strip()].add(row['route_id'].strip())

# shapes.txt: build shape_id → ordered coordinate list
raw_shapes = defaultdict(list)
for row in csv.DictReader(io.StringIO(shapes_csv)):
    raw_shapes[row['shape_id'].strip()].append((
        int(row['shape_pt_sequence']),
        float(row['shape_pt_lon']),
        float(row['shape_pt_lat']),
    ))

# Sort each shape by sequence and drop duplicate consecutive coordinates
def build_coords(pts):
    pts.sort(key=lambda p: p[0])
    coords, prev = [], None
    for _, lon, lat in pts:
        c = [round(lon, 6), round(lat, 6)]
        if c != prev:
            coords.append(c)
            prev = c
    return coords

# ── Build GeoJSON ────────────────────────────────────────────────────────────
features = []
seen = set()
for shape_id, pts in raw_shapes.items():
    if shape_id in seen:
        continue
    seen.add(shape_id)

    coords = build_coords(pts)
    if len(coords) < 2:
        continue

    routes   = sorted(shape_to_routes.get(shape_id, set()))
    route_id = routes[0] if routes else ''
    color    = LINE_COLORS.get(route_id, '#888899')

    features.append({
        'type': 'Feature',
        'geometry': {
            'type': 'LineString',
            'coordinates': coords,
        },
        'properties': {
            'shapeId': shape_id,
            'routeId': route_id,
            'routes':  routes,
            'color':   color,
        },
    })

geojson = {'type': 'FeatureCollection', 'features': features}

# ── Write ───────────────────────────────────────────────────────────────────
out = os.path.normpath(OUT_PATH)
with open(out, 'w') as f:
    json.dump(geojson, f, separators=(',', ':'))

size_kb = os.path.getsize(out) // 1024
print(f'\n✓  {len(features)} shapes written to:')
print(f'   {out}')
print(f'   ({size_kb} KB)')
print('\nNext steps:')
print('  git add subway-lines.geojson')
print('  git commit -m "Add static GTFS subway line geometry"')
print('  git push')
