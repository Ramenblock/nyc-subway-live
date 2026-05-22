/**
 * api/stops.js
 *
 * Returns a lookup table of every NYC subway stop: stop_id → { name, lat, lon }
 *
 * Three layers of fallback so something always works:
 *   1. Download the MTA's own official static GTFS zip → parse stops.txt (most accurate)
 *   2. Fall back to NYC Open Data JSON API
 *   3. Fall back to hardcoded coordinates covering all lines (always works)
 */

const JSZip = require('jszip');

let cache = null;
let cacheTime = 0;
const CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

// MTA publishes static GTFS at several possible URLs — try each in order
const MTA_GTFS_URLS = [
  'http://web.mta.info/developers/data/nyct/subway/google_transit.zip',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-static',
];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');

  if (cache && Date.now() - cacheTime < CACHE_MS) {
    return res.status(200).json(cache);
  }

  // ── Attempt 1: MTA static GTFS zip ──────────────────────────────────
  for (const url of MTA_GTFS_URLS) {
    try {
      const stops = await downloadGTFS(url);
      if (Object.keys(stops).length > 200) {
        cache = stops; cacheTime = Date.now();
        console.log(`Loaded ${Object.keys(stops).length} stops from MTA GTFS`);
        return res.status(200).json(stops);
      }
    } catch (e) {
      console.warn(`MTA GTFS failed (${url}):`, e.message);
    }
  }

  // ── Attempt 2: NYC Open Data ─────────────────────────────────────────
  try {
    const stops = await fetchOpenData();
    if (Object.keys(stops).length > 100) {
      cache = stops; cacheTime = Date.now();
      console.log(`Loaded ${Object.keys(stops).length} stops from NYC Open Data`);
      return res.status(200).json(stops);
    }
  } catch (e) {
    console.warn('NYC Open Data failed:', e.message);
  }

  // ── Attempt 3: Hardcoded fallback ────────────────────────────────────
  console.log('Using hardcoded stop fallback');
  const stops = buildHardcodedStops();
  return res.status(200).json(stops);
};

// ── MTA static GTFS downloader ───────────────────────────────────────────

async function downloadGTFS(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  if (!zip.file('stops.txt')) throw new Error('stops.txt not in ZIP');
  const csv = await zip.file('stops.txt').async('string');
  return parseStopsCSV(csv);
}

function parseStopsCSV(text) {
  const rows = text.split('\n');
  const h = rows[0].trim().split(',');
  const ix = (name) => h.indexOf(name);
  const idI = ix('stop_id'), nameI = ix('stop_name'), latI = ix('stop_lat'), lonI = ix('stop_lon');
  const stops = {};
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].trim().split(',');
    if (!c[idI]) continue;
    const id = c[idI].trim();
    const lat = parseFloat(c[latI]);
    const lon = parseFloat(c[lonI]);
    if (isNaN(lat) || isNaN(lon)) continue;
    const entry = { name: (c[nameI] || id).replace(/"/g, '').trim(), lat, lon };
    stops[id] = entry;
    if (!id.endsWith('N') && !id.endsWith('S')) {
      stops[id + 'N'] = entry;
      stops[id + 'S'] = entry;
    }
  }
  return stops;
}

// ── NYC Open Data fallback ───────────────────────────────────────────────

async function fetchOpenData() {
  const url = 'https://data.cityofnewyork.us/resource/arq3-7z49.json?$limit=1000';
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const stops = {};
  for (const s of data) {
    if (!s.gtfs_stop_id || !s.the_geom) continue;
    const id = s.gtfs_stop_id.trim();
    const [lon, lat] = s.the_geom.coordinates;
    const entry = { name: s.stop_name || id, lat: parseFloat(lat), lon: parseFloat(lon) };
    stops[id] = entry;
    stops[id + 'N'] = entry;
    stops[id + 'S'] = entry;
  }
  return stops;
}

// ── Hardcoded fallback — covers all lines ────────────────────────────────
// Format: "ID": ["Name", lat, lon]
// Directional variants (N/S) are added automatically below.

function buildHardcodedStops() {
  const raw = {
    // ── 1 train (IRT Broadway-7th Ave Local) ───────────────────────────
    "101":["Van Cortlandt Park-242 St",40.889248,-73.898583],
    "103":["238 St",40.884667,-73.900870],
    "104":["231 St",40.878856,-73.904834],
    "106":["Marble Hill-225 St",40.874561,-73.909831],
    "107":["215 St",40.869444,-73.915253],
    "108":["207 St",40.864621,-73.918822],
    "109":["Dyckman St",40.860531,-73.924929],
    "110":["191 St",40.855225,-73.929971],
    "111":["181 St",40.849505,-73.933596],
    "112":["168 St",40.840719,-73.939561],
    "113":["157 St",40.833396,-73.943866],
    "114":["145 St",40.826775,-73.950579],
    "115":["137 St-City College",40.822187,-73.954882],
    "116":["125 St",40.815581,-73.958372],
    "117":["116 St-Columbia University",40.808746,-73.964873],
    "118":["Cathedral Pkwy (110 St)",40.803967,-73.966847],
    "119":["103 St",40.799446,-73.968382],
    "120":["96 St",40.793919,-73.972323],
    "121":["86 St",40.789023,-73.976218],
    "122":["79 St",40.783934,-73.979820],
    "123":["72 St",40.778453,-73.982209],
    "124":["66 St-Lincoln Center",40.773609,-73.982414],
    "125":["59 St-Columbus Circle",40.768247,-73.981929],
    "126":["50 St",40.761728,-73.983849],
    "127":["Times Sq-42 St",40.755477,-73.987691],
    "128":["34 St-Penn Station",40.750373,-73.991057],
    "129":["28 St",40.747718,-73.993391],
    "130":["23 St",40.744299,-73.995929],
    "131":["18 St",40.741790,-73.997930],
    "132":["14 St",40.737826,-74.000201],
    "133":["Christopher St-Sheridan Sq",40.733422,-74.002906],
    "134":["Houston St",40.728251,-74.005367],
    "135":["Canal St",40.723065,-74.004131],
    "136":["Franklin St",40.718803,-74.009781],
    "137":["Chambers St",40.713282,-74.009774],
    "138":["WTC Cortlandt",40.711835,-74.012433],
    "139":["Rector St",40.707557,-74.013823],
    "140":["South Ferry",40.702068,-74.013201],
    // ── 2/3 Bronx (White Plains Rd) ────────────────────────────────────
    "201":["Wakefield-241 St",40.903125,-73.850620],
    "204":["Nereid Av",40.897027,-73.854882],
    "205":["Burke Av",40.889395,-73.860341],
    "206":["Allerton Av",40.865462,-73.867164],
    "207":["Pelham Pkwy",40.857788,-73.867029],
    "208":["Gun Hill Rd",40.852559,-73.867457],
    "209":["180 St",40.847391,-73.874427],
    "210":["Tremont Av",40.840459,-73.878855],
    "211":["174-175 Sts",40.836795,-73.882935],
    "212":["Freeman St",40.829993,-73.891472],
    "213":["Simpson St",40.824073,-73.893878],
    "214":["Intervale Av",40.822138,-73.896736],
    "215":["Prospect Av",40.819547,-73.901975],
    "216":["Jackson Av",40.816104,-73.907098],
    "217":["3 Av-149 St",40.816109,-73.912399],
    "218":["149 St-Grand Concourse",40.818099,-73.926800],
    // ── 2/3 Manhattan (Lenox/7th Ave Express) ──────────────────────────
    "220":["135 St",40.814229,-73.939545],
    "221":["125 St",40.807836,-73.945831],
    "222":["116 St",40.802423,-73.950385],
    "223":["110 St",40.796428,-73.953433],
    "224":["103 St",40.791087,-73.947304],
    "225":["96 St",40.784044,-73.947650],
    "226":["86 St",40.777861,-73.953664],
    "227":["72 St",40.768602,-73.958131],
    // ── 2/3 Brooklyn ───────────────────────────────────────────────────
    "228":["Eastern Pkwy-Brooklyn Museum",40.671920,-73.963660],
    "229":["Grand Army Plaza",40.675368,-73.971287],
    "230":["Prospect Park",40.661499,-73.962314],
    "231":["Parkside Av",40.655292,-73.961453],
    "232":["Church Av",40.650508,-73.962867],
    "233":["Beverly Rd",40.644618,-73.962590],
    "234":["Cortelyou Rd",40.640927,-73.962793],
    "235":["Newkirk Av",40.635782,-73.962792],
    "236":["Avenue H",40.630315,-73.963215],
    "237":["Avenue J",40.625050,-73.963585],
    "238":["Avenue M",40.619589,-73.963901],
    "239":["Kings Hwy",40.611655,-73.963430],
    "240":["Avenue U",40.598622,-73.963848],
    "241":["Neck Rd",40.595498,-73.966115],
    "242":["Sheepshead Bay",40.586896,-73.954443],
    "243":["Brighton Beach",40.577722,-73.961340],
    "244":["Ocean Pkwy",40.576127,-73.968985],
    "245":["W 8 St-NY Aquarium",40.576127,-73.975834],
    "246":["Coney Island-Stillwell Av",40.577422,-73.981233],
    // ── 4 train Bronx (Jerome Ave) ─────────────────────────────────────
    "401":["Woodlawn",40.887324,-73.878704],
    "402":["Mosholu Pkwy",40.878906,-73.879399],
    "403":["Bedford Park Blvd-Lehman College",40.873421,-73.890064],
    "405":["Kingsbridge Rd",40.865462,-73.897474],
    "406":["Fordham Rd",40.861296,-73.897414],
    "407":["Burnside Av",40.853453,-73.901444],
    "408":["176 St",40.847388,-73.901427],
    "409":["Mt Eden Av",40.844017,-73.909180],
    "410":["170 St",40.840047,-73.912550],
    "411":["167 St",40.836519,-73.916559],
    "412":["161 St-Yankee Stadium",40.827999,-73.925831],
    "413":["149 St-Grand Concourse",40.818497,-73.927336],
    "414":["138 St-Grand Concourse",40.813148,-73.929448],
    // ── 5 train Bronx (Dyre Ave) ───────────────────────────────────────
    "501":["Eastchester-Dyre Av",40.887908,-73.830579],
    "502":["Baychester Av",40.878663,-73.838413],
    "503":["Gun Hill Rd",40.877362,-73.846450],
    "504":["Pelham Pkwy",40.858602,-73.855539],
    "505":["Morris Park",40.855470,-73.865090],
    // ── 6 train Bronx (Pelham Bay) ─────────────────────────────────────
    "601":["Pelham Bay Park",40.871900,-73.828750],
    "602":["Buhre Av",40.874900,-73.836500],
    "603":["Middletown Rd",40.870491,-73.843793],
    "604":["Westchester Sq-E Tremont Av",40.855877,-73.843285],
    "606":["Zerega Av",40.850483,-73.847448],
    "607":["Castle Hill Av",40.843852,-73.851590],
    "608":["Parkchester",40.833565,-73.860946],
    "609":["St Lawrence Av",40.831906,-73.869283],
    "610":["Morrison Av-Soundview",40.829728,-73.874022],
    "611":["Elder Av",40.828699,-73.879040],
    "612":["Whitlock Av",40.826525,-73.886283],
    "613":["Hunts Point Av",40.820458,-73.890745],
    "614":["Longwood Av",40.816575,-73.896435],
    "615":["E 149 St",40.816109,-73.904098],
    "616":["E 143 St-St Mary's St",40.813224,-73.908219],
    "617":["Cypress Av",40.810562,-73.914042],
    "618":["Brook Av",40.807566,-73.919289],
    "619":["3 Av-138 St",40.810454,-73.926344],
    // ── 4/5/6 Manhattan (Lexington Ave) ────────────────────────────────
    "621":["138 St-Grand Concourse (4/5)",40.813148,-73.929448],
    "623":["125 St",40.804138,-73.937594],
    "624":["116 St",40.798629,-73.940870],
    "625":["110 St",40.795010,-73.943160],
    "626":["103 St",40.790433,-73.947516],
    "627":["96 St",40.784992,-73.951418],
    "628":["86 St",40.778919,-73.954317],
    "629":["77 St",40.773709,-73.957561],
    "630":["68 St-Hunter College",40.768141,-73.964038],
    "631":["59 St",40.762526,-73.967967],
    "632":["51 St",40.757106,-73.971290],
    "633":["Grand Central-42 St",40.751776,-73.976848],
    "634":["33 St",40.746418,-73.982956],
    "635":["28 St",40.743828,-73.985942],
    "636":["23 St",40.740403,-73.986962],
    "637":["14 St-Union Sq",40.734673,-73.989951],
    "638":["Astor Pl",40.730054,-73.991070],
    "639":["Bleecker St",40.725915,-73.994659],
    "640":["Spring St",40.722301,-73.997031],
    "641":["Canal St",40.718379,-74.000056],
    "642":["Brooklyn Bridge-City Hall",40.713065,-74.004131],
    "643":["Fulton St",40.710374,-74.007598],
    "644":["Wall St",40.706178,-74.009781],
    "645":["Bowling Green",40.704906,-74.014034],
    "646":["Borough Hall",40.692536,-73.990149],
    "647":["Nevins St",40.688651,-73.980129],
    "648":["Atlantic Av-Barclays Ctr",40.684359,-73.977666],
    "649":["Crown Hts-Utica Av",40.669295,-73.942426],
    "650":["Sutter Av-Rutland Rd",40.664717,-73.932400],
    "651":["Saratoga Av",40.661614,-73.928822],
    "652":["Rockaway Av",40.662549,-73.921290],
    "653":["Junius St",40.659580,-73.913585],
    "654":["Pennsylvania Av",40.655292,-73.904429],
    "655":["Van Siclen Av",40.651152,-73.893051],
    "656":["New Lots Av",40.648016,-73.886685],
    "657":["Flatbush Av-Brooklyn College",40.632152,-73.947478],
    // ── 7 train (IRT Flushing) ──────────────────────────────────────────
    "701":["Flushing-Main St",40.757671,-73.830030],
    "702":["Mets-Willets Point",40.754501,-73.845583],
    "705":["111 St",40.750980,-73.855861],
    "706":["103 St-Corona Plaza",40.749865,-73.862633],
    "707":["Junction Blvd",40.748408,-73.869587],
    "708":["90 St-Elmhurst Av",40.746644,-73.875522],
    "709":["82 St-Jackson Heights",40.745752,-73.882695],
    "710":["74 St-Broadway",40.746848,-73.891394],
    "711":["69 St",40.746325,-73.898115],
    "712":["Woodside-61 St",40.745851,-73.902984],
    "713":["52 St",40.744149,-73.912698],
    "714":["46 St-Bliss St",40.744216,-73.917997],
    "715":["40 St-Lowery St",40.743781,-73.924028],
    "716":["33 St-Rawson St",40.744230,-73.930511],
    "718":["Queensboro Plaza",40.750582,-73.940202],
    "719":["Court Sq",40.747023,-73.945264],
    "720":["Hunters Point Av",40.742216,-73.949575],
    "721":["Vernon Blvd-Jackson Av",40.742572,-73.953581],
    "723":["Times Sq-42 St",40.755477,-73.987691],
    "724":["34 St-Hudson Yards",40.754862,-74.001769],
    // ── A/C/E (IND 8th Ave) ─────────────────────────────────────────────
    "A02":["Inwood-207 St",40.868072,-73.919899],
    "A03":["Dyckman St",40.865490,-73.925080],
    "A05":["190 St",40.859022,-73.934158],
    "A06":["181 St",40.851695,-73.937969],
    "A07":["175 St",40.847391,-73.942812],
    "A09":["168 St-Washington Heights",40.840896,-73.940793],
    "A10":["163 St-Amsterdam Av",40.836013,-73.939892],
    "A11":["155 St",40.830953,-73.941600],
    "A12":["145 St",40.824783,-73.944216],
    "A14":["135 St",40.817894,-73.947632],
    "A15":["125 St",40.811109,-73.951761],
    "A16":["116 St",40.805776,-73.954882],
    "A17":["110 St",40.800964,-73.958161],
    "A18":["103 St",40.796092,-73.961180],
    "A19":["96 St",40.791642,-73.963786],
    "A20":["86 St",40.787094,-73.967914],
    "A21":["81 St-Museum of Natural History",40.784318,-73.972182],
    "A22":["72 St",40.780769,-73.976250],
    "A24":["59 St-Columbus Circle",40.768247,-73.981929],
    "A25":["50 St",40.763972,-73.985097],
    "A27":["42 St-Port Authority Bus Terminal",40.757308,-73.989735],
    "A28":["34 St-Penn Station",40.752287,-73.993391],
    "A29":["23 St",40.745906,-73.998041],
    "A30":["14 St",40.740893,-74.001678],
    "A31":["W 4 St-Washington Sq",40.732338,-74.000495],
    "A32":["Spring St",40.726335,-74.003904],
    "A33":["Canal St",40.720824,-74.005210],
    "A34":["Chambers St",40.714335,-74.008585],
    "A36":["Fulton St",40.709178,-74.007953],
    "A38":["High St-Brooklyn Bridge",40.699337,-73.990903],
    "A40":["Jay St-MetroTech",40.692339,-73.987384],
    "A41":["DeKalb Av",40.688484,-73.981890],
    "A42":["Atlantic Av-Barclays Ctr",40.684359,-73.977666],
    "A43":["Nostrand Av",40.680504,-73.950430],
    "A44":["Kingston-Throop Avs",40.679921,-73.940846],
    "A45":["Ralph Av",40.678880,-73.920770],
    "A46":["Utica Av",40.679166,-73.930455],
    "A47":["Van Siclen Av",40.668897,-73.891394],
    "A48":["Shepherd Av",40.662549,-73.880776],
    "A49":["Broadway Junction",40.678334,-73.905355],
    "A50":["Alabama Av",40.666891,-73.897499],
    "A51":["Van Siclen Av (A)",40.662549,-73.891394],
    "A52":["Cleveland St",40.659580,-73.884277],
    "A53":["Norwood Av",40.656250,-73.876953],
    "A54":["Liberty Av",40.674774,-73.878174],
    "A55":["Aqueduct-North Conduit Av",40.668217,-73.834400],
    "A57":["Howard Beach-JFK Airport",40.659900,-73.830170],
    "A59":["Broad Channel",40.608704,-73.815925],
    "A60":["Beach 67 St",40.588715,-73.814810],
    "A61":["Beach 60 St",40.592374,-73.806702],
    "A63":["Beach 44 St",40.590927,-73.793604],
    "A64":["Beach 36 St",40.595398,-73.788605],
    "A65":["Beach 25 St",40.600967,-73.781334],
    // ── B/D Bronx (IND Concourse) ───────────────────────────────────────
    "D01":["Norwood-205 St",40.874582,-73.878409],
    "D03":["Bedford Park Blvd",40.873421,-73.887138],
    "D04":["Kingsbridge Rd",40.865407,-73.897674],
    "D05":["Fordham Rd",40.860827,-73.897079],
    "D06":["182-183 Sts",40.856093,-73.901149],
    "D07":["Tremont Av",40.850226,-73.904834],
    "D08":["174-175 Sts",40.840833,-73.912621],
    "D09":["170 St",40.836940,-73.916900],
    "D10":["167 St",40.833529,-73.919891],
    "D11":["161 St-Yankee Stadium",40.828041,-73.925617],
    "D12":["155 St",40.830953,-73.937592],
    "D13":["145 St",40.826775,-73.944216],
    "D14":["135 St",40.818843,-73.947803],
    // ── B/D/F/M Manhattan (6th Ave) ─────────────────────────────────────
    "D15":["125 St",40.811109,-73.952428],
    "D16":["116 St",40.805176,-73.956039],
    "D17":["110 St-Cathedral Pkwy",40.799484,-73.958580],
    "D18":["103 St-Central Park North",40.793919,-73.961655],
    "D19":["96 St",40.788582,-73.965881],
    "D20":["86 St",40.782536,-73.970168],
    "D21":["81 St-Museum of Natural History",40.779453,-73.973095],
    "D22":["72 St",40.775594,-73.976417],
    "F14":["57 St-7 Av",40.764664,-73.980976],
    "F15":["47-50 Sts-Rockefeller Ctr",40.758663,-73.981963],
    "F16":["42 St-Bryant Park",40.754222,-73.984569],
    "F17":["34 St-Herald Sq",40.749567,-73.987950],
    "F18":["23 St",40.742878,-73.992821],
    "F19":["14 St",40.738228,-73.996151],
    "F20":["W 4 St-Washington Sq",40.732338,-74.000495],
    "F21":["Broadway-Lafayette St",40.725284,-73.996012],
    "F22":["Delancey St-Essex St",40.718292,-73.987608],
    "F23":["East Broadway",40.713974,-73.984861],
    "F24":["York St",40.701420,-73.986754],
    "F25":["Jay St-MetroTech",40.692339,-73.987384],
    "F26":["Bergen St",40.686111,-73.990862],
    "F27":["Carroll St",40.680303,-73.994040],
    "F29":["Smith-9 Sts",40.673582,-73.995959],
    "F30":["4 Av-9 St",40.670272,-73.989779],
    "F31":["7 Av",40.665518,-73.980165],
    "F32":["15 St-Prospect Park",40.660397,-73.979493],
    "F33":["Fort Hamilton Pkwy",40.650621,-73.985024],
    "F34":["Church Av",40.644041,-73.979681],
    "F35":["Ditmas Av",40.636411,-73.978661],
    "F36":["18 Av",40.630297,-73.979420],
    "F38":["Avenue I",40.625186,-73.980942],
    "F39":["Bay Pkwy",40.619589,-73.981659],
    // ── F/M Queens (IND Queens Blvd) ───────────────────────────────────
    "F01":["Jamaica-179 St",40.712584,-73.783794],
    "F02":["169 St",40.711835,-73.793604],
    "F03":["Parsons Blvd",40.710374,-73.803558],
    "F04":["Sutphin Blvd",40.709166,-73.811501],
    "F05":["Briarwood-Van Wyck Blvd",40.708424,-73.820100],
    "F06":["Kew Gardens-Union Tpke",40.714996,-73.831100],
    "F07":["75 Av",40.718616,-73.837929],
    "F09":["Forest Hills-71 Av",40.721691,-73.844521],
    "F10":["67 Av",40.724811,-73.852478],
    "F11":["63 Dr-Rego Park",40.726590,-73.861763],
    "F12":["Woodhaven Blvd",40.733106,-73.869316],
    "F13":["Jackson Hts-Roosevelt Av",40.745860,-73.891394],
    // ── G train (IND Crosstown) ─────────────────────────────────────────
    "G05":["Court Sq",40.747023,-73.945264],
    "G06":["21 St",40.744291,-73.949832],
    "G07":["Greenpoint Av",40.731352,-73.954449],
    "G08":["Nassau Av",40.724635,-73.951277],
    "G09":["Metropolitan Av",40.712792,-73.951418],
    "G10":["Broadway",40.706092,-73.950608],
    "G11":["Flushing Av",40.700377,-73.950310],
    "G12":["Myrtle-Willoughby Avs",40.694568,-73.949046],
    "G13":["Bedford-Nostrand Avs",40.689627,-73.953522],
    "G14":["Classon Av",40.688873,-73.960070],
    "G15":["Clinton-Washington Avs",40.688056,-73.966357],
    "G16":["Fulton St",40.687119,-73.975375],
    "G18":["Hoyt-Schermerhorn Sts",40.688232,-73.985001],
    "G19":["Bergen St",40.686140,-73.990862],
    "G20":["Carroll St",40.680303,-73.994040],
    "G21":["Smith-9 Sts",40.673582,-73.995959],
    "G22":["4 Av-9 St",40.670272,-73.989779],
    "G24":["7 Av",40.666389,-73.980000],
    "G26":["15 St-Prospect Park",40.660397,-73.979493],
    "G29":["Fort Hamilton Pkwy",40.650621,-73.985024],
    "G30":["Church Av",40.644041,-73.979681],
    // ── J/Z (BMT Jamaica) ───────────────────────────────────────────────
    "J12":["Jamaica Center-Parsons/Archer",40.702562,-73.801109],
    "J13":["Sutphin Blvd-Archer Av-JFK",40.700437,-73.808075],
    "J14":["Jamaica-Van Wyck",40.700268,-73.816859],
    "J15":["121 St",40.700292,-73.827577],
    "J16":["111 St",40.698138,-73.837559],
    "J17":["Woodhaven Blvd",40.693879,-73.851576],
    "J19":["75 St-Elderts Lane",40.691507,-73.861343],
    "J20":["85 St-Forest Pkwy",40.687495,-73.872688],
    "J21":["Cypress Hills",40.688946,-73.880051],
    "J22":["Highland Blvd",40.682087,-73.885700],
    "J23":["Broadway Junction",40.678334,-73.905355],
    "J24":["Halsey St",40.687315,-73.915279],
    "J25":["Gates Av",40.689627,-73.922913],
    "J27":["Kosciuszko St",40.693453,-73.928814],
    "J28":["Myrtle Av",40.697207,-73.935364],
    "J29":["Lorimer St",40.703423,-73.946940],
    "J30":["Hewes St",40.708391,-73.953676],
    "J31":["Marcy Av",40.708119,-73.957757],
    // J/Z Manhattan (BMT Nassau St)
    "M18":["Essex St",40.718292,-73.987608],
    "M19":["Bowery",40.720229,-73.993915],
    "M20":["Canal St",40.718092,-74.000201],
    "M21":["Chambers St",40.713243,-74.003401],
    "M22":["Fulton St",40.710374,-74.007598],
    "M23":["Broad St",40.706647,-74.011719],
    // ── L train (BMT Canarsie) ──────────────────────────────────────────
    "L01":["8 Av",40.740893,-74.006021],
    "L02":["6 Av",40.740494,-74.000598],
    "L03":["14 St-Union Sq",40.734789,-73.990568],
    "L05":["3 Av",40.732849,-73.986599],
    "L06":["1 Av",40.730952,-73.981628],
    "L08":["Bedford Av",40.717304,-73.956587],
    "L10":["Lorimer St",40.714552,-73.950000],
    "L11":["Graham Av",40.714332,-73.944158],
    "L12":["Grand St",40.711317,-73.940220],
    "L13":["Montrose Av",40.707939,-73.935657],
    "L14":["Morgan Av",40.706152,-73.930280],
    "L15":["Jefferson St",40.706091,-73.922752],
    "L16":["DeKalb Av",40.703811,-73.918929],
    "L17":["Myrtle-Wyckoff Avs",40.699601,-73.912806],
    "L19":["Halsey St",40.697428,-73.904429],
    "L20":["Wilson Av",40.688618,-73.904150],
    "L21":["Bushwick Av-Aberdeen St",40.682829,-73.905509],
    "L22":["Broadway Junction",40.678334,-73.905355],
    "L24":["Atlantic Av",40.675342,-73.903745],
    "L25":["East New York",40.671484,-73.887085],
    "L26":["Van Siclen Av",40.664717,-73.877223],
    "L27":["Livonia Av",40.662549,-73.872494],
    "L28":["New Lots Av",40.658733,-73.867700],
    "L29":["East 105 St",40.650736,-73.899149],
    "L30":["Canarsie-Rockaway Pkwy",40.646655,-73.901218],
    // ── N/W Astoria (BMT Astoria) ───────────────────────────────────────
    "R01":["Astoria-Ditmars Blvd",40.775036,-73.912034],
    "R03":["Astoria Blvd",40.770258,-73.917843],
    "R04":["30 Av",40.766779,-73.921479],
    "R05":["Broadway",40.761820,-73.925508],
    "R06":["36 Av",40.756804,-73.929575],
    "R08":["39 Av-Dutch Kills",40.752882,-73.932755],
    "R09":["Queensboro Plaza",40.750582,-73.940202],
    // N/Q/R/W Manhattan (BMT Broadway)
    "R11":["Lexington Av-59 St",40.762526,-73.967967],
    "R13":["5 Av-59 St",40.764811,-73.973347],
    "R14":["57 St-7 Av",40.764664,-73.980976],
    "R16":["Times Sq-42 St",40.755477,-73.987691],
    "R17":["34 St-Herald Sq",40.749567,-73.987950],
    "R18":["28 St",40.745494,-73.988568],
    "R19":["23 St",40.741303,-73.989344],
    "R20":["14 St-Union Sq",40.735736,-73.990550],
    "R21":["8 St-NYU",40.730328,-73.992416],
    "R22":["Prince St",40.724330,-73.997466],
    "R23":["Canal St",40.718092,-74.000201],
    "R24":["City Hall",40.713282,-74.009774],
    "R25":["Cortlandt St",40.711835,-74.012433],
    "R26":["Rector St",40.707557,-74.013823],
    "R27":["Whitehall St-South Ferry",40.703087,-74.013753],
    // R/N Brooklyn
    "R28":["Court St",40.694074,-73.991399],
    "R29":["Jay St-MetroTech",40.692413,-73.986835],
    "R30":["DeKalb Av",40.690515,-73.981928],
    "R31":["Atlantic Av-Barclays Ctr",40.684359,-73.977666],
    "R32":["Union St",40.677316,-73.983391],
    "R33":["4 Av-9 St",40.670272,-73.989779],
    "R34":["Prospect Av",40.665744,-73.994536],
    "R35":["25 St",40.660397,-73.998091],
    "R36":["36 St",40.655144,-74.003549],
    "R39":["59 St",40.641549,-74.017859],
    "R40":["Bay Ridge-77 St",40.629090,-74.025761],
    "R41":["Bay Ridge-95 St",40.616622,-74.030876],
    // Q Brooklyn/Brighton Beach
    "Q01":["96 St",40.784448,-73.947564],
    "Q03":["86 St",40.777349,-73.951940],
    "Q05":["72 St",40.768922,-73.958131],
    "B08":["Atlantic Av-Barclays Ctr",40.684359,-73.977666],
    "B10":["7 Av",40.677707,-73.972084],
    "B12":["Prospect Park",40.661499,-73.962314],
    "B13":["Church Av",40.650508,-73.962867],
    "B14":["Beverly Rd",40.644618,-73.962590],
    "B15":["Cortelyou Rd",40.640927,-73.962793],
    "B16":["Newkirk Av",40.635782,-73.962792],
    "B17":["Avenue H",40.630315,-73.963215],
    "B19":["Avenue J",40.625050,-73.963585],
    "B20":["Avenue M",40.619589,-73.963901],
    "B21":["Kings Hwy",40.608600,-73.963430],
    "B22":["Avenue U",40.598622,-73.963848],
    "B23":["Neck Rd",40.595498,-73.966115],
    "B24":["Sheepshead Bay",40.586896,-73.954443],
    "B25":["Brighton Beach",40.577722,-73.961340],
    "B26":["Ocean Pkwy",40.576127,-73.968985],
    "B27":["W 8 St-NY Aquarium",40.576127,-73.975834],
    // ── N/Q/R Queens ───────────────────────────────────────────────────
    "R44":["Forest Hills-71 Av",40.721691,-73.844521],
    "R45":["67 Av",40.724811,-73.852478],
    "R46":["63 Dr-Rego Park",40.726590,-73.861763],
    "R47":["Woodhaven Blvd",40.733106,-73.869316],
    "R48":["Jackson Hts-Roosevelt Av",40.745860,-73.891394],
    "R49":["74 St-Broadway",40.746848,-73.891394],
    // ── Staten Island Railway ───────────────────────────────────────────
    "S01":["St George",40.643748,-74.073643],
    "S03":["Tompkinsville",40.636566,-74.074294],
    "S04":["Stapleton",40.627915,-74.075130],
    "S05":["Clifton",40.622398,-74.073982],
    "S06":["Grasmere",40.603053,-74.084591],
    "S07":["Old Town",40.597440,-74.084765],
    "S08":["Dongan Hills",40.590927,-74.085815],
    "S09":["Jefferson Av",40.583830,-74.087473],
    "S10":["Grant City",40.576127,-74.090347],
    "S11":["New Dorp",40.573418,-74.117980],
    "S12":["Oakwood Heights",40.565720,-74.121048],
    "S13":["Bay Terrace",40.556763,-74.129810],
    "S14":["Great Kills",40.551073,-74.151370],
    "S15":["Eltingville",40.544644,-74.163639],
    "S16":["Annadale",40.540179,-74.175415],
    "S17":["Huguenot",40.534542,-74.183838],
    "S18":["Prince's Bay",40.525131,-74.194136],
    "S19":["Pleasant Plains",40.518374,-74.200048],
    "S20":["Richmond Valley",40.512764,-74.207474],
    "S21":["Arthur Kill",40.509408,-74.237701],
    "S22":["Tottenville",40.500916,-74.252987],
    // ── S Shuttles ─────────────────────────────────────────────────────
    "901":["Grand Central-42 St",40.752769,-73.979189],
    "902":["Times Sq-42 St",40.755477,-73.987691],
    "H01":["Far Rockaway-Mott Av",40.604505,-73.755405],
    "H02":["Mott Av",40.612406,-73.762584],
    "H03":["Beach 25 St",40.600967,-73.781334],
    "H04":["Beach 44 St",40.590927,-73.793604],
    "H06":["Beach 60 St",40.592374,-73.806702],
    "H07":["Beach 67 St",40.588715,-73.814810],
    "H08":["Beach 90 St",40.588715,-73.814810],
    "H09":["Beach 98 St",40.588715,-73.831576],
    "H10":["Beach 105 St",40.607600,-73.835915],
    "H11":["Rockaway Park-Beach 116 St",40.580632,-73.847506],
    "H12":["Broad Channel",40.608704,-73.815925],
    "H13":["Howard Beach-JFK Airport",40.659900,-73.830170],
    "H14":["Aqueduct-North Conduit Av",40.668217,-73.834400],
    "H15":["Aqueduct Racetrack",40.672097,-73.834092],
  };

  const stops = {};
  for (const [id, [name, lat, lon]] of Object.entries(raw)) {
    const entry = { name, lat, lon };
    stops[id] = entry;
    stops[id + 'N'] = entry;
    stops[id + 'S'] = entry;
  }
  return stops;
}
