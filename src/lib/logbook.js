/**
 * The trip lifecycle against storage: start, end, edit, discard.
 * The rules themselves live in trip.js.
 */
import { deleteTrip, getAllTrips, getTrip, newId, putTrip } from './db.js';
import { latestOdometer } from './trip.js';

/** Everything a view needs in one read. */
export async function loadState() {
  const trips = await getAllTrips();
  return {
    trips,
    openTrip: trips.find((t) => !t.end) || null,
    latestOdometer: latestOdometer(trips),
  };
}

export async function startTrip({ odometer, at }) {
  const { openTrip } = await loadState();
  if (openTrip) throw new Error('A trip is already in progress.');

  const now = new Date().toISOString();
  return putTrip({
    id: newId(),
    purpose: '',
    start: { odometer: Number(odometer), at: at || now },
    end: null,
    createdAt: now,
  });
}

export async function endTrip(tripId, { odometer, at, purpose }) {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error('That trip no longer exists.');
  if (trip.end) throw new Error('That trip is already finished.');

  return putTrip({
    ...trip,
    purpose: String(purpose || '').trim(),
    end: { odometer: Number(odometer), at: at || new Date().toISOString() },
  });
}

/** Abandons an open trip. */
export async function cancelTrip(tripId) {
  const trip = await getTrip(tripId);
  if (!trip) return;
  if (trip.end) throw new Error('That trip is finished and cannot be discarded.');
  await deleteTrip(tripId);
}

export async function updateTrip(tripId, changes) {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error('That trip no longer exists.');
  return putTrip({ ...trip, ...changes, id: trip.id });
}

export { deleteTrip };
