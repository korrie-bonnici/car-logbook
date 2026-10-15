/**
 * IndexedDB persistence.
 *
 * Four stores:
 *   trips    - one record per trip, with an embedded start and end reading
 *   periods  - optional ATO logbook periods (12 continuous weeks, typically)
 *   photos   - compressed odometer JPEGs, kept apart so trip reads stay light
 *   meta     - small key/value odds and ends (last backup time, etc.)
 *
 * A trip is "open" while its `end` is null. That is derived rather than
 * stored in meta so the two can never disagree.
 */
import { openDB } from 'idb';

const DB_NAME = 'car-logbook';
const DB_VERSION = 1;

export const STORES = {
  trips: 'trips',
  periods: 'periods',
  photos: 'photos',
  meta: 'meta',
};

let dbPromise = null;

function connect() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORES.trips)) {
          const trips = db.createObjectStore(STORES.trips, { keyPath: 'id' });
          trips.createIndex('byStartedAt', 'start.at');
        }
        if (!db.objectStoreNames.contains(STORES.periods)) {
          const periods = db.createObjectStore(STORES.periods, { keyPath: 'id' });
          periods.createIndex('byStartedAt', 'start.at');
        }
        if (!db.objectStoreNames.contains(STORES.photos)) {
          db.createObjectStore(STORES.photos, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
      },
      blocked() {
        console.warn('[db] upgrade blocked by another open tab');
      },
    });
  }
  return dbPromise;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------------------------------------------------------- trips -- */

export async function getAllTrips() {
  const db = await connect();
  const trips = await db.getAll(STORES.trips);
  return trips.sort(byStartDescending);
}

export async function getTrip(id) {
  const db = await connect();
  return db.get(STORES.trips, id);
}

export async function putTrip(trip) {
  const db = await connect();
  const record = { ...trip, updatedAt: new Date().toISOString() };
  await db.put(STORES.trips, record);
  return record;
}

export async function deleteTrip(id) {
  const db = await connect();
  const trip = await db.get(STORES.trips, id);
  const photoIds = [trip?.start?.photoId, trip?.end?.photoId].filter(Boolean);

  const tx = db.transaction([STORES.trips, STORES.photos], 'readwrite');
  await Promise.all([
    tx.objectStore(STORES.trips).delete(id),
    ...photoIds.map((pid) => tx.objectStore(STORES.photos).delete(pid)),
    tx.done,
  ]);
}

export async function getOpenTrip() {
  const trips = await getAllTrips();
  return trips.find((t) => !t.end) || null;
}

/**
 * Highest odometer reading recorded anywhere (trips or periods), which is the
 * floor for the next reading. Returns null when nothing is recorded yet.
 */
export async function getLatestOdometer() {
  const [trips, periods] = await Promise.all([getAllTrips(), getAllPeriods()]);
  const readings = [];
  for (const t of trips) {
    if (Number.isFinite(t?.start?.odometer)) readings.push(t.start.odometer);
    if (Number.isFinite(t?.end?.odometer)) readings.push(t.end.odometer);
  }
  for (const p of periods) {
    if (Number.isFinite(p?.start?.odometer)) readings.push(p.start.odometer);
    if (Number.isFinite(p?.end?.odometer)) readings.push(p.end.odometer);
  }
  return readings.length ? Math.max(...readings) : null;
}

/* -------------------------------------------------------------- periods -- */

export async function getAllPeriods() {
  const db = await connect();
  const periods = await db.getAll(STORES.periods);
  return periods.sort(byStartDescending);
}

export async function getPeriod(id) {
  const db = await connect();
  return db.get(STORES.periods, id);
}

export async function putPeriod(period) {
  const db = await connect();
  const record = { ...period, updatedAt: new Date().toISOString() };
  await db.put(STORES.periods, record);
  return record;
}

export async function deletePeriod(id) {
  const db = await connect();
  const period = await db.get(STORES.periods, id);
  const photoIds = [period?.start?.photoId, period?.end?.photoId].filter(Boolean);

  const tx = db.transaction([STORES.periods, STORES.photos], 'readwrite');
  await Promise.all([
    tx.objectStore(STORES.periods).delete(id),
    ...photoIds.map((pid) => tx.objectStore(STORES.photos).delete(pid)),
    tx.done,
  ]);
}

export async function getOpenPeriod() {
  const periods = await getAllPeriods();
  return periods.find((p) => !p.end) || null;
}

/* --------------------------------------------------------------- photos -- */

export async function putPhoto(photo) {
  const db = await connect();
  await db.put(STORES.photos, photo);
  return photo;
}

export async function getPhoto(id) {
  if (!id) return null;
  const db = await connect();
  return (await db.get(STORES.photos, id)) || null;
}

export async function getAllPhotos() {
  const db = await connect();
  return db.getAll(STORES.photos);
}

export async function deletePhoto(id) {
  if (!id) return;
  const db = await connect();
  await db.delete(STORES.photos, id);
}

/** Drops photos no trip or period refers to. Cheap insurance against leaks. */
export async function pruneOrphanPhotos() {
  const [trips, periods, photos] = await Promise.all([
    getAllTrips(),
    getAllPeriods(),
    getAllPhotos(),
  ]);
  const referenced = new Set();
  for (const r of [...trips, ...periods]) {
    if (r?.start?.photoId) referenced.add(r.start.photoId);
    if (r?.end?.photoId) referenced.add(r.end.photoId);
  }
  const orphans = photos.filter((p) => !referenced.has(p.id));
  await Promise.all(orphans.map((p) => deletePhoto(p.id)));
  return orphans.length;
}

/* ----------------------------------------------------------------- meta -- */

export async function getMeta(key, fallback = null) {
  const db = await connect();
  const row = await db.get(STORES.meta, key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const db = await connect();
  await db.put(STORES.meta, { key, value });
  return value;
}

export async function getAllMeta() {
  const db = await connect();
  return db.getAll(STORES.meta);
}

/* ------------------------------------------------------ bulk replacement -- */

/**
 * Wipes everything and writes the supplied records. Used by restore, where a
 * half-applied backup would be worse than none, so it runs in one transaction.
 */
export async function replaceAll({ trips = [], periods = [], photos = [], meta = [] }) {
  const db = await connect();
  const tx = db.transaction(
    [STORES.trips, STORES.periods, STORES.photos, STORES.meta],
    'readwrite',
  );

  await Promise.all([
    tx.objectStore(STORES.trips).clear(),
    tx.objectStore(STORES.periods).clear(),
    tx.objectStore(STORES.photos).clear(),
    tx.objectStore(STORES.meta).clear(),
  ]);

  await Promise.all([
    ...trips.map((t) => tx.objectStore(STORES.trips).put(t)),
    ...periods.map((p) => tx.objectStore(STORES.periods).put(p)),
    ...photos.map((p) => tx.objectStore(STORES.photos).put(p)),
    ...meta.map((m) => tx.objectStore(STORES.meta).put(m)),
  ]);

  await tx.done;
}

/** Removes every record. Used by the "Erase all data" action in Settings. */
export async function wipeEverything() {
  await replaceAll({ trips: [], periods: [], photos: [], meta: [] });
}

/* ---------------------------------------------------------------- utils -- */

function byStartDescending(a, b) {
  const at = a?.start?.at || '';
  const bt = b?.start?.at || '';
  if (at === bt) return 0;
  return at < bt ? 1 : -1;
}

/** Rough storage usage, for the Settings screen. */
export async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/**
 * Asks the browser to make storage persistent so Android will not evict the
 * database under storage pressure. Silently no-ops where unsupported.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
