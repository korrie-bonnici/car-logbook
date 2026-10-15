/**
 * IndexedDB persistence.
 *
 * Two stores:
 *   trips - one record per trip, with its start and end readings
 *   meta  - small key/value odds and ends (last backup time)
 *
 * A trip is "open" while its `end` is null. That is derived rather than
 * stored in meta so the two can never disagree.
 *
 * Version 1 of the database also kept odometer photos and logbook periods.
 * Upgrading to version 2 deletes both and reshapes each trip in place.
 */
import { openDB } from 'idb';
import { normaliseTrip } from './trip.js';

const DB_NAME = 'car-logbook';
const DB_VERSION = 2;

const TRIPS = 'trips';
const META = 'meta';

let dbPromise = null;

function connect() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(TRIPS)) {
          db.createObjectStore(TRIPS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' });
        }
        if (oldVersion === 1) await upgradeFromVersionOne(db, tx);
      },
      blocked() {
        console.warn('[db] upgrade blocked by another open tab');
      },
    });
  }
  return dbPromise;
}

async function upgradeFromVersionOne(db, tx) {
  for (const name of ['photos', 'periods']) {
    if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
  }

  const trips = tx.objectStore(TRIPS);
  if (trips.indexNames.contains('byStartedAt')) trips.deleteIndex('byStartedAt');

  let cursor = await trips.openCursor();
  while (cursor) {
    try {
      await cursor.update(normaliseTrip(cursor.value));
    } catch (err) {
      // Never silently drop a record during an upgrade: leave it as it was.
      console.warn('[db] could not upgrade a trip, left unchanged', err);
    }
    cursor = await cursor.continue();
  }

  // Version 1 bookkeeping that no longer means anything.
  const meta = tx.objectStore(META);
  for (const key of ['backupPending', 'lastBackupTarget', 'restoredAt']) {
    await meta.delete(key);
  }
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------------------------------------------------------- trips -- */

/** Every trip, newest first. */
export async function getAllTrips() {
  const db = await connect();
  const trips = await db.getAll(TRIPS);
  return trips.sort(byStartDescending);
}

export async function getTrip(id) {
  const db = await connect();
  return db.get(TRIPS, id);
}

export async function putTrip(trip) {
  const db = await connect();
  const record = { ...trip, updatedAt: new Date().toISOString() };
  await db.put(TRIPS, record);
  return record;
}

export async function deleteTrip(id) {
  const db = await connect();
  await db.delete(TRIPS, id);
}

/* ----------------------------------------------------------------- meta -- */

export async function getMeta(key, fallback = null) {
  const db = await connect();
  const row = await db.get(META, key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const db = await connect();
  await db.put(META, { key, value });
  return value;
}

/* ------------------------------------------------------ bulk replacement -- */

/**
 * Wipes every trip and writes the supplied ones, with the given meta rows.
 * One transaction, so a restore is never left half applied.
 */
export async function replaceAll({ trips = [], meta = [] }) {
  const db = await connect();
  const tx = db.transaction([TRIPS, META], 'readwrite');
  await Promise.all([tx.objectStore(TRIPS).clear(), tx.objectStore(META).clear()]);
  await Promise.all([
    ...trips.map((t) => tx.objectStore(TRIPS).put(t)),
    ...meta.map((m) => tx.objectStore(META).put(m)),
  ]);
  await tx.done;
}

export async function wipeEverything() {
  await replaceAll({});
}

/** Store names, for the upgrade test. */
export async function storeNames() {
  const db = await connect();
  return db.objectStoreNames;
}

/* ---------------------------------------------------------------- utils -- */

function byStartDescending(a, b) {
  const at = a?.start?.at || '';
  const bt = b?.start?.at || '';
  if (at === bt) return 0;
  return at < bt ? 1 : -1;
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
