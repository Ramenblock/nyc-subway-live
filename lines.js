/**
 * api/lines.js
 *
 * Returns GeoJSON of all NYC subway line paths, fetched from NYC Open Data.
 * Each feature gets a `color` property matching the MTA's brand colours so
 * the map can draw each route in the right colour.
 *
 * The route lines rarely change (maybe once a year), so we cache for 7 days.
 */

// Maps the rt_symbol values used by NYC Open Data to MTA brand colours.
// rt_symbol contains values like "1 2 3", "A C E", "G", "SI", etc.
const SYMBOL_COLORS = {
  '1 2 3':    '#EE352E',
  '1':        '#EE352E',
  '2':        '#EE352E',
  '3':        '#EE352E',
  '4 5 6':    '#00933C',
  '4 5':      '#00933C',
  '4':        '#00933C',
  '5':        '#00933C',
  '6':        '#00933C',
  '7':        '#B933AD',
  'A C E':    '#0039A6',
  'A C':      '#0039A6',
  'A':        '#0039A6',
  'C':        '#0039A6',
  'E':        '#0039A6',
  'SI':       '#0039A6',
  'B D F M':  '#FF6319',
  'B D':      '#FF6319',
  'F M':      '#FF6319',
  'B':        '#FF6319',
  'D':        '#FF6319',
  'F':        '#FF6319',
  'M':        '#FF6319',
  'G':        '#6CBE45',
  'J Z':      '#996633',
  'J':        '#996633',
  'Z':        '#996633',
  'L':        '#A7A9AC',
  'N Q R W':  '#FCCC0A',
  'N Q R':    '#FCCC0A',
  'N W':      '#FCCC0A',
  'N':        '#FCCC0A',
  'Q':        '#FCCC0A',
  'R':        '#FCCC0A',
  'W':        '#FCCC0A',
  'S':        '#808183',
  'GS':       '#808183',
  'FS':       '#808183',
  'H':        '#808183',
};

module.exports = async (req, res) => {
  // Cache aggressively — subway line geometry barely ever changes
  res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');

  try {
    // NYC Open Data: Subway Lines (dataset 3qem-6v3v)
    const url = 'https://data.cityofnewyork.us/api/geospatial/3qem-6v3v?method=export&type=GeoJSON';
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      throw new Error(`NYC Open Data returned HTTP ${response.status}`);
    }

    const geojson = await response.json();

    // Attach colour and a cleaned symbol to each feature
    for (const feature of geojson.features) {
      const props = feature.properties || {};

      // The dataset uses rt_symbol or name depending on the export version
      const raw = (props.rt_symbol || props.name || '').trim();

      feature.properties.color  = SYMBOL_COLORS[raw] || '#555555';
      feature.properties.symbol = raw;
    }

    return res.status(200).json(geojson);

  } catch (err) {
    console.error('Lines fetch failed:', err.message);
    // Return an empty FeatureCollection so the map layer stays silent rather than crashing
    return res.status(200).json({
      type: 'FeatureCollection',
      features: [],
      error: err.message,
    });
  }
};
