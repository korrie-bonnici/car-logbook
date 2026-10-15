/**
 * User-facing flows that span capture, storage and backup.
 *
 * Views call these and then re-render; they hold no UI state of their own.
 */
import { captureReading } from '../views/capture.js';
import { getLatestOdometer, putPhoto, deletePhoto } from './db.js';
import {
  endPeriod,
  endTrip,
  startPeriod,
  startTrip,
  validateEnd,
  validateStart,
} from './logbook.js';
import { backupToDrive, hasValidToken } from './drive.js';
import { markBackupPending } from './backup.js';
import { isDriveConfigured } from './config.js';
import { toast } from './ui.js';

/* ------------------------------------------------------------- trips -- */

/** Returns true when a trip was started. */
export async function startTripFlow() {
  const latestOdometer = await getLatestOdometer();

  const result = await captureReading({
    title: 'Start trip',
    hint: 'Photograph the odometer before you set off.',
    submitLabel: 'Start trip',
    showBusiness: true,
    validate: (value) => validateStart(value, { latestOdometer }),
  });
  if (!result) return false;

  await putPhoto(result.photo);
  try {
    await startTrip({
      odometer: result.odometer,
      at: result.at,
      photoId: result.photo.id,
      business: result.business,
    });
  } catch (err) {
    // Roll the orphaned photo back so storage does not drift.
    await deletePhoto(result.photo.id);
    throw err;
  }

  toast('Trip started. Drive safely.', { type: 'success' });
  return true;
}

/** Returns true when the trip was closed. */
export async function endTripFlow(openTrip) {
  if (!openTrip) return false;
  const startOdometer = openTrip.start.odometer;

  const result = await captureReading({
    title: 'End trip',
    hint: 'Photograph the odometer now that you have arrived.',
    submitLabel: 'Save trip',
    requireNotes: true,
    initialNotes: openTrip.notes || '',
    showBusiness: true,
    initialBusiness: openTrip.business !== false,
    validate: (value) => validateEnd(value, { startOdometer }),
  });
  if (!result) return false;

  await putPhoto(result.photo);
  try {
    await endTrip(openTrip.id, {
      odometer: result.odometer,
      at: result.at,
      photoId: result.photo.id,
      notes: result.notes,
      business: result.business,
    });
  } catch (err) {
    await deletePhoto(result.photo.id);
    throw err;
  }

  const km = result.odometer - startOdometer;
  toast(`Trip saved. ${km.toLocaleString('en-AU')} km recorded.`, { type: 'success' });

  // Fire and forget: a backup must never hold up the UI.
  void autoBackup();
  return true;
}

/* ----------------------------------------------------------- periods -- */

export async function startPeriodFlow() {
  const latestOdometer = await getLatestOdometer();

  const result = await captureReading({
    title: 'Start logbook period',
    hint: 'Photograph the odometer on the first day of the period.',
    submitLabel: 'Start period',
    validate: (value) => validateStart(value, { latestOdometer }),
  });
  if (!result) return false;

  await putPhoto(result.photo);
  try {
    await startPeriod({
      odometer: result.odometer,
      at: result.at,
      photoId: result.photo.id,
    });
  } catch (err) {
    await deletePhoto(result.photo.id);
    throw err;
  }

  toast('Logbook period started.', { type: 'success' });
  return true;
}

export async function endPeriodFlow(openPeriod) {
  if (!openPeriod) return false;
  const startOdometer = openPeriod.start.odometer;

  const result = await captureReading({
    title: 'End logbook period',
    hint: 'Photograph the odometer on the last day of the period.',
    submitLabel: 'Close period',
    validate: (value) => validateEnd(value, { startOdometer }),
  });
  if (!result) return false;

  await putPhoto(result.photo);
  try {
    await endPeriod(openPeriod.id, {
      odometer: result.odometer,
      at: result.at,
      photoId: result.photo.id,
    });
  } catch (err) {
    await deletePhoto(result.photo.id);
    throw err;
  }

  toast('Logbook period closed.', { type: 'success' });
  void autoBackup();
  return true;
}

/* ------------------------------------------------------------ backup -- */

/**
 * Backs up to Drive if a valid token is already held.
 *
 * Deliberately non-interactive: it will not pop a Google sign-in window
 * behind your back. When it cannot run, it flags a pending backup and the
 * home screen shows the "Backup needed" banner instead.
 */
export async function autoBackup() {
  if (!isDriveConfigured()) {
    await markBackupPending();
    return { ran: false, reason: 'unconfigured' };
  }
  if (!navigator.onLine) {
    await markBackupPending();
    return { ran: false, reason: 'offline' };
  }
  if (!hasValidToken()) {
    await markBackupPending();
    return { ran: false, reason: 'no-token' };
  }

  try {
    const file = await backupToDrive({ interactive: false });
    toast('Backed up to Google Drive.', { type: 'success' });
    return { ran: true, file };
  } catch (err) {
    console.warn('[backup] auto-backup failed', err);
    await markBackupPending();
    return { ran: false, reason: 'error', error: err };
  }
}
