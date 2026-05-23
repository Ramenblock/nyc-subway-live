/**
 * api/subway.js
 *
 * Fetches all 9 MTA GTFS-RT feeds in parallel and returns every active
 * train's position plus schedule data for smooth client-side interpolation.
 *
 * Each feed contains two types of messages we care about:
 *   • VehiclePosition — where the train is right now (stop it's at/heading to)
 *   • TripUpdate      — scheduled arrival/departure times at upcoming stops
 *
 * We do two passes per feed:
 *   Pass 1: collect TripUpdate data indexed by trip_id
 *   Pass 2: process VehiclePositions, enrich each with schedule times so the
 *           browser can compute real-time interpolated positions every second.
 */

const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

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
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');

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
    meta: { count: vehicles.length, failedFeeds, timestamp: Date.now() },
  });
};

// ── Feed fetcher ────────────────────────────────────────────────────────

async function fetchFeed(feedId) {
  const url = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/${feedId}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Feed ${feedId} returned HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  const feed   = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  // ── Pass 1: collect TripUpdate stop-time sequences ─────────────────
  // Indexed by trip_id so we can look them up in pass 2.
  const tripUpdates = {};

  for (const entity of feed.entity) {
    if (!entity.tripUpdate || !entity.tripUpdate.trip) continue;
    const tripId = (entity.tripUpdate.trip.tripId || '').trim();
    if (!tripId) continue;

    tripUpdates[tripId] = (entity.tripUpdate.stopTimeUpdate || []).map(u => ({
      stopId:    (u.stopId || '').trim(),
      stopSeq:   u.stopSequence || 0,
      arrival:   toUnix(u.arrival   && u.arrival.time),
      departure: toUnix(u.departure && u.departure.time),
    }));
  }

  // ── Pass 2: process VehiclePositions ──────────────────────────────
  const vehicles = [];

  for (const entity of feed.entity) {
    if (!entity.vehicle || !entity.vehicle.trip) continue;

    const v       = entity.vehicle;
    const pos     = v.position;
    const tripId  = (v.trip.tripId  || '').trim();
    const routeId = (v.trip.routeId || '').trim();
    const stopId  = (v.stopId || '').trim();
    // currentStatus: 0 = INCOMING_AT, 1 = STOPPED_AT, 2 = IN_TRANSIT_TO
    const status  = v.currentStatus != null ? Number(v.currentStatus) : null;
    const curSeq  = v.currentStopSequence || 0;

    // ── Enrich with schedule data ────────────────────────────────────
    let prevStopId    = null;
    let nextStopId    = null;
    let departureTime = null;
    let arrivalTime   = null;

    const updates = tripUpdates[tripId] || [];
    if (updates.length > 0) {
      // Find the current stop — prefer sequence match, fall back to ID match
      const bare = stopId.replace(/[NS]$/, '');
      let curIdx = curSeq > 0
        ? updates.findIndex(u => u.stopSeq === curSeq)
        : -1;
      if (curIdx < 0) {
        curIdx = updates.findIndex(u =>
          u.stopId === stopId || u.stopId.replace(/[NS]$/, '') === bare
        );
      }

      if (curIdx >= 0) {
        if (status === 1 /* STOPPED_AT */ && curIdx < updates.length - 1) {
          // At this stop, departing toward the next one
          prevStopId    = stopId;
          nextStopId    = updates[curIdx + 1].stopId;
          departureTime = updates[curIdx].departure;
          arrivalTime   = updates[curIdx + 1].arrival;
        } else if (status !== 1 && curIdx > 0) {
          // En route to this stop from the previous one
          prevStopId    = updates[curIdx - 1].stopId;
          nextStopId    = stopId;
          departureTime = updates[curIdx - 1].departure;
          arrivalTime   = updates[curIdx].arrival;
        }
      }
    }

    vehicles.push({
      id:            entity.id,
      routeId,
      tripId,
      stopId,
      currentStatus: status,
      lat:  pos ? pos.latitude  : null,
      lon:  pos ? pos.longitude : null,
      // Schedule interpolation fields (null when unavailable)
      prevStopId,
      nextStopId,
      departureTime,
      arrivalTime,
    });
  }

  return vehicles;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a protobuf timestamp (Long object or plain number) to a plain
 * JavaScript Unix timestamp in seconds.
 */
function toUnix(t) {
  if (!t) return null;
  if (typeof t === 'number') return t;
  if (typeof t.toNumber === 'function') return t.toNumber();
  // Low/high words of a 64-bit int; for timestamps < 2^31 high === 0
  return (t.low >>> 0) || null;
}
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
