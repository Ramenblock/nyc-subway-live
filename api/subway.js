/**
 * api/subway.js
 *
 * Fetches all 9 MTA GTFS-RT feeds in parallel.
 * For each feed, two passes are done:
 *   Pass 1 — collect TripUpdate schedule data (wrapped in try/catch — non-fatal)
 *   Pass 2 — process VehiclePositions and enrich with schedule data
 *
 * If TripUpdate parsing fails for any reason, trains still appear on the map;
 * they just won't have the schedule-based interpolation fields.
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

async function fetchFeed(feedId) {
  const url = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/${feedId}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Feed ${feedId} returned HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  const feed   = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  // ── Pass 1: collect TripUpdate schedule data ───────────────────────
  let tripUpdates = {};
  try {
    for (const entity of feed.entity) {
      const tu = entity.tripUpdate || entity.trip_update;
      if (!tu) continue;
      const trip = tu.trip;
      if (!trip) continue;
      const tripId = ((trip.tripId || trip.trip_id || '') + '').trim();
      if (!tripId) continue;
      const stopTimeUpdates = tu.stopTimeUpdate || tu.stop_time_update || [];
      tripUpdates[tripId] = stopTimeUpdates.map(u => ({
        stopId:    ((u.stopId    || u.stop_id    || '') + '').trim(),
        stopSeq:    u.stopSequence || u.stop_sequence || 0,
        arrival:   toUnix(u.arrival   && u.arrival.time),
        departure: toUnix(u.departure && u.departure.time),
      }));
    }
  } catch (err) {
    console.warn('TripUpdate pass failed (non-fatal):', err.message);
    tripUpdates = {};
  }

  // ── Pass 2: VehiclePositions ───────────────────────────────────────
  const vehicles = [];

  for (const entity of feed.entity) {
    if (!entity.vehicle || !entity.vehicle.trip) continue;

    const v      = entity.vehicle;
    const pos    = v.position;
    const tripId = ((v.trip.tripId || '') + '').trim();
    const stopId = ((v.stopId      || '') + '').trim();
    const status = v.currentStatus ?? null;
    const curSeq = v.currentStopSequence || 0;

    let prevStopId = null, nextStopId = null, departureTime = null, arrivalTime = null;

    try {
      const updates = tripUpdates[tripId] || [];
      if (updates.length > 0) {
        const bare = stopId.replace(/[NS]$/, '');
        let idx = curSeq > 0
          ? updates.findIndex(u => u.stopSeq === curSeq)
          : -1;
        if (idx < 0) {
          idx = updates.findIndex(u =>
            u.stopId === stopId ||
            u.stopId.replace(/[NS]$/, '') === bare
          );
        }
        if (idx >= 0) {
          const numStatus = Number(status);
          if (numStatus === 1 && idx < updates.length - 1) {
            prevStopId    = stopId;
            nextStopId    = updates[idx + 1].stopId;
            departureTime = updates[idx].departure;
            arrivalTime   = updates[idx + 1].arrival;
          } else if (numStatus !== 1 && idx > 0) {
            prevStopId    = updates[idx - 1].stopId;
            nextStopId    = stopId;
            departureTime = updates[idx - 1].departure;
            arrivalTime   = updates[idx].arrival;
          }
        }
      }
    } catch (err) {
      // Non-fatal — train still appears, just at stop position
    }

    vehicles.push({
      id:            entity.id,
      routeId:       (v.trip.routeId || '').trim(),
      tripId,
      stopId,
      currentStatus: status,
      lat:  pos ? pos.latitude  : null,
      lon:  pos ? pos.longitude : null,
      prevStopId,
      nextStopId,
      departureTime,
      arrivalTime,
    });
  }

  return vehicles;
}

function toUnix(t) {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  if (typeof t.toNumber === 'function') return t.toNumber();
  return (t.low >>> 0) || null;
}
