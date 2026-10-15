/**
 * Backup files: one small JSON file holding every trip.
 *
 * Saved through the Android share sheet (or a download on desktop) and
 * restored from the file picker. Without photos a year of trips is a few KB.
 */
import { getAllTrips, getMeta, replaceAll, setMeta } from './db.js';
import { normaliseTrip } from './trip.js';
import { fileStamp } from './dates.js';

export const SCHEMA_VERSION = 2;
export const APP_TAG = 'car-logbook';
export const META_LAST_BACKUP_AT = 'lastBackupAt';

/** Days after the last backup before the home screen starts nudging. */
export const REMINDER_AFTER_DAYS = 30;

export class BackupFormatError extends Error {}

export function backupFilename(date = new Date()) {
  return `car-logbook-${fileStamp(date)}.json`;
}

/* ---------------------------------------------------------------- build -- */

export function buildBackupPayload(trips, now = new Date()) {
  return {
    app: APP_TAG,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    trips,
  };
}

export async function buildBackupFile() {
  const payload = buildBackupPayload(await getAllTrips());
  return {
    payload,
    blob: new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }),
    filename: backupFilename(new Date(payload.exportedAt)),
  };
}

/* -------------------------------------------------------------- restore -- */

/**
 * Parses and checks a backup file's text. Accepts files from the first
 * version of the app too, whose photos and logbook periods are ignored.
 * Returns { trips, exportedAt }; throws BackupFormatError otherwise.
 */
export function parseBackup(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BackupFormatError('That file is not a Car Logbook backup.');
  }
  if (!payload || typeof payload !== 'object' || payload.app !== APP_TAG) {
    throw new BackupFormatError('That file was not made by Car Logbook.');
  }
  if (Number(payload.schemaVersion) > SCHEMA_VERSION) {
    throw new BackupFormatError(
      'That backup was made by a newer version of the app. Update the app first.',
    );
  }
  if (!Array.isArray(payload.trips)) {
    throw new BackupFormatError('That backup has no trip list.');
  }

  const trips = payload.trips.map((raw, index) => {
    try {
      return normaliseTrip(raw);
    } catch {
      throw new BackupFormatError(`Trip ${index + 1} in that backup is damaged.`);
    }
  });

  return { trips, exportedAt: payload.exportedAt || null };
}

/**
 * Replaces every trip with the backup's. The backup's own time becomes the
 * last backup time, since the device now holds exactly what that file does.
 */
export async function applyRestore({ trips, exportedAt }) {
  await replaceAll({
    trips,
    meta: [{ key: META_LAST_BACKUP_AT, value: exportedAt || new Date().toISOString() }],
  });
}

/* ------------------------------------------------------------- reminder -- */

export async function markBackedUp(at = new Date()) {
  await setMeta(META_LAST_BACKUP_AT, at.toISOString());
}

export function getLastBackupAt() {
  return getMeta(META_LAST_BACKUP_AT);
}

/**
 * Whether the home screen should nudge for a backup.
 *
 * `unsaved` counts finished trips changed since the last backup (a trip in
 * progress waits until it ends). The nudge shows when
 * there are any and either nothing was ever backed up or the last backup is
 * older than REMINDER_AFTER_DAYS.
 */
export function backupReminder({ trips, lastBackupAt, now = new Date() }) {
  const last = lastBackupAt ? new Date(lastBackupAt) : null;
  const unsaved = trips.filter(
    (t) => t.end && (!last || new Date(t.updatedAt || t.createdAt || 0) > last),
  ).length;

  const stale = !last || now - last > REMINDER_AFTER_DAYS * 86_400_000;
  return { show: unsaved > 0 && stale, unsaved };
}
