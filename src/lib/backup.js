/**
 * Backup payloads: one self-contained JSON object holding every trip, every
 * logbook period and every odometer photo as base64.
 *
 * The same payload is used by the Drive upload and the Android share sheet,
 * so a backup saved either way can be restored by either path.
 */
import {
  getAllMeta,
  getAllPeriods,
  getAllPhotos,
  getAllTrips,
  replaceAll,
  setMeta,
} from './db.js';
import { base64ToBlob, blobToBase64 } from './photo.js';
import { fileStamp } from './dates.js';

export const SCHEMA_VERSION = 1;
export const APP_TAG = 'car-logbook';

/** Meta keys that describe this device, not the logbook, so are not restored. */
const TRANSIENT_META = new Set(['driveToken']);

export function backupFilename(date = new Date()) {
  return `car-logbook-${fileStamp(date)}.json`;
}

/* ---------------------------------------------------------------- build -- */

export async function buildBackup() {
  const [trips, periods, photos, meta] = await Promise.all([
    getAllTrips(),
    getAllPeriods(),
    getAllPhotos(),
    getAllMeta(),
  ]);

  const encodedPhotos = [];
  for (const photo of photos) {
    // Sequential on purpose: encoding hundreds of images at once will spike
    // memory on a phone, and this runs in the background anyway.
    // eslint-disable-next-line no-await-in-loop
    const data = await blobToBase64(photo.blob);
    encodedPhotos.push({
      id: photo.id,
      type: photo.type || 'image/jpeg',
      width: photo.width ?? null,
      height: photo.height ?? null,
      bytes: photo.bytes ?? photo.blob?.size ?? null,
      createdAt: photo.createdAt || null,
      data,
    });
  }

  return {
    app: APP_TAG,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      trips: trips.length,
      periods: periods.length,
      photos: encodedPhotos.length,
    },
    trips,
    periods,
    photos: encodedPhotos,
    meta: meta.filter((row) => !TRANSIENT_META.has(row.key)),
  };
}

export async function buildBackupBlob() {
  const payload = await buildBackup();
  const json = JSON.stringify(payload);
  return {
    payload,
    blob: new Blob([json], { type: 'application/json' }),
    filename: backupFilename(new Date(payload.exportedAt)),
  };
}

/* -------------------------------------------------------------- restore -- */

export class BackupFormatError extends Error {}

/** Throws BackupFormatError unless this really is one of our backups. */
export function validateBackup(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new BackupFormatError('That file is not a Car Logbook backup.');
  }
  if (payload.app !== APP_TAG) {
    throw new BackupFormatError('That file was not produced by Car Logbook.');
  }
  if (!Array.isArray(payload.trips)) {
    throw new BackupFormatError('That backup has no trip list.');
  }
  if (Number(payload.schemaVersion) > SCHEMA_VERSION) {
    throw new BackupFormatError(
      'That backup was made by a newer version of the app. Update the app first.',
    );
  }
  return true;
}

export function describeBackup(payload) {
  const trips = Array.isArray(payload?.trips) ? payload.trips.length : 0;
  const photos = Array.isArray(payload?.photos) ? payload.photos.length : 0;
  const periods = Array.isArray(payload?.periods) ? payload.periods.length : 0;
  return { trips, photos, periods, exportedAt: payload?.exportedAt || null };
}

/**
 * Replaces all local data with the backup's contents.
 * Destructive by design: restore means restore, not merge.
 */
export async function restoreBackup(payload) {
  validateBackup(payload);

  const photos = (payload.photos || []).map((p) => ({
    id: p.id,
    blob: base64ToBlob(p.data, p.type || 'image/jpeg'),
    type: p.type || 'image/jpeg',
    width: p.width ?? null,
    height: p.height ?? null,
    bytes: p.bytes ?? null,
    createdAt: p.createdAt || null,
  }));

  const meta = (payload.meta || []).filter(
    (row) => row && typeof row.key === 'string' && !TRANSIENT_META.has(row.key),
  );

  await replaceAll({
    trips: payload.trips || [],
    periods: payload.periods || [],
    photos,
    meta,
  });

  await setMeta('restoredAt', new Date().toISOString());

  return describeBackup(payload);
}

export async function parseBackupFile(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BackupFormatError('That file is not valid JSON.');
  }
  validateBackup(payload);
  return payload;
}

/* ----------------------------------------------------- backup bookkeeping -- */

export const META_LAST_BACKUP_AT = 'lastBackupAt';
export const META_LAST_BACKUP_TARGET = 'lastBackupTarget';
export const META_PENDING_BACKUP = 'backupPending';

export async function markBackedUp(target) {
  await setMeta(META_LAST_BACKUP_AT, new Date().toISOString());
  await setMeta(META_LAST_BACKUP_TARGET, target);
  await setMeta(META_PENDING_BACKUP, false);
}

export async function markBackupPending() {
  await setMeta(META_PENDING_BACKUP, true);
}
