/**
 * api/subway.js
 *
 * This is a "serverless function" — a tiny piece of server code that Vercel
 * runs on demand when the map page asks for fresh train data.
 *
 * What it does:
 *   1. Calls all 9 MTA real-time feeds simultaneously (no API key needed — they're public)
 *   2. Parses the binary (protobuf) data into readable JavaScript objects
 *   3. Returns a clean list of every active train and its position
 *
 * Why it lives on the server (not in the browser):
 *   - Avoids browser security restrictions on cross-origin requests (CORS)
 *   - Lets us cache and combine all 9 feeds into one clean response
 */

const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

// The MTA splits their real-time data across 9 separate feeds, one per line group.
// We fetch all of them in parallel so the map shows every line at once.
const FEEDS = [
  { id: 'nyct%2Fgtfs',      lines: '1 2 3 4 5 6 S' },
  { id: 'nyct%2Fgtfs-ace',  lines: 'A C E'         },
  { id: 'nyct%2Fgtfs-bdfm', lines: 'B D F M'       },
  { id: 'nyct%2Fgtfs-g',    lines: 'G'              },
  { id: 'nyct%2Fgtfs-jz',   lines: 'J Z'            },
  { id: 'nyct%2Fgtfs-l',    lines: 'L'              },
  { id: 'nyct%2Fgtfs-nqrw', lines: 'N Q R W'        },
  { id: 'nyct%2Fgtfs-7',    lines: '7'              },
  { id: 'nyct%2Fgtfs-si',   lines: 'SI'             },
];

module.exports = async (req, res) => {
  // Cache response for 10 seconds — trains move slowly enough that
  // this reduces MTA API calls without losing meaningful accuracy
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');

  // Fetch all feeds at once — Promise.allSettled means one failing feed
  // won't break the rest of the map
  const results = await Promise.allSettled(
    FEEDS.map(feed => fetchFeed(feed.id))
  );

  const vehicles = [];
  let failedFeeds = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      vehicles.push(...result.value);
    } else {
      failedFeeds++;
      console.error('Feed failed:', result.reason?.message);
    }
  }

  return res.status(200).json({
    vehicles,
    meta: {
      count: vehicles.length,
      failedFeeds,
      timestamp: Date.now(),
    }
  });
};

/**
 * Fetches and parses a single MTA GTFS-RT feed.
 * Returns an array of vehicle position objects.
 */
async function fetchFeed(feedId) {
  const url = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/${feedId}`;

  // The MTA feeds are publicly accessible — no API key required
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000), // Give up after 8 seconds
  });

  if (!response.ok) {
    throw new Error(`Feed ${feedId} returned HTTP ${response.status}`);
  }

  // The MTA sends data in "protobuf" format — a compact binary encoding.
  // gtfs-realtime-bindings decodes it into a regular JavaScript object.
  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  const vehicles = [];

  for (const entity of feed.entity) {
    // Each entity is either a VehiclePosition, a TripUpdate, or an Alert.
    // We only care about VehiclePosition for the live map.
    if (!entity.vehicle || !entity.vehicle.trip) continue;

    const v = entity.vehicle;
    const pos = v.position;

    vehicles.push({
      // Unique ID for this vehicle
      id: entity.id,

      // Which subway line (e.g. "A", "6", "L")
      routeId: (v.trip.routeId || '').trim(),

      // Internal trip identifier — useful for matching with schedule data
      tripId: v.trip.tripId || '',

      // Which stop the train is at or heading towards
      stopId: v.stopId || '',

      // Status: 0 = incoming at stop, 1 = stopped at stop, 2 = in transit to stop
      currentStatus: v.currentStatus ?? null,

      // GPS coordinates — present for most modern subway cars
      // Null for older cars or lines not yet equipped
      lat: pos ? pos.latitude : null,
      lon: pos ? pos.longitude : null,
    });
  }

  return vehicles;
}
