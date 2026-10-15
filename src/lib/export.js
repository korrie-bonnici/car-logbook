/**
 * The accountant's CSV, and getting files off the phone through the Android
 * share sheet (or a plain download where sharing files is unsupported).
 */
import { financialYearLabel, formatDate, formatTime } from './dates.js';
import { tripKm, tripsInFinancialYear } from './trip.js';
import { buildBackupFile, markBackedUp } from './backup.js';

/* ------------------------------------------------------------------ CSV -- */

const COLUMNS = [
  'Date',
  'Start time',
  'End time',
  'Start odometer (km)',
  'End odometer (km)',
  'Distance (km)',
  'Purpose',
];

/**
 * Escapes a CSV field. Excel treats a leading =, +, - or @ as a formula, so
 * those get a leading apostrophe. Trip purposes are free text and could
 * otherwise be read as one.
 */
function csvField(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\n\r,]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(values) {
  return values.map(csvField).join(',');
}

export function buildCsv(trips, financialYear) {
  const rows = tripsInFinancialYear(trips, financialYear);
  const lines = [csvRow(COLUMNS)];

  for (const trip of rows) {
    lines.push(
      csvRow([
        formatDate(trip.start.at),
        formatTime(trip.start.at),
        formatTime(trip.end.at),
        trip.start.odometer,
        trip.end.odometer,
        tripKm(trip),
        trip.purpose || '',
      ]),
    );
  }

  lines.push('');
  lines.push(csvRow(['Financial year', financialYearLabel(financialYear)]));
  lines.push(csvRow(['Trips', rows.length]));
  lines.push(csvRow(['Total business km', rows.reduce((sum, t) => sum + tripKm(t), 0)]));

  // BOM so Excel opens it as UTF-8 without being asked.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvFilename(financialYear) {
  return `car-logbook-FY${financialYearLabel(financialYear)}.csv`;
}

/* -------------------------------------------------------------- sharing -- */

/** True when this browser can share actual files, not just links. */
export function canShareFiles() {
  if (!navigator.canShare || !navigator.share) return false;
  try {
    const probe = new File(['{}'], 'probe.json', { type: 'application/json' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Offers a file through the share sheet where available, otherwise
 * downloads it. Returns 'shared', 'downloaded' or 'cancelled'.
 */
export async function shareOrDownload(blob, filename, { title, text } = {}) {
  if (canShareFiles()) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, text });
        return 'shared';
      } catch (err) {
        // AbortError means the sheet was dismissed, which is not a failure.
        if (err?.name === 'AbortError') return 'cancelled';
        // Anything else: fall through to a download rather than dead-end.
      }
    }
  }

  downloadBlob(blob, filename);
  return 'downloaded';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ---------------------------------------------------------- entry points -- */

export async function exportCsv(trips, financialYear) {
  // text/csv without a charset parameter: Android's share sheet matches the
  // bare type, and the BOM already marks the file as UTF-8.
  const blob = new Blob([buildCsv(trips, financialYear)], { type: 'text/csv' });
  return shareOrDownload(blob, csvFilename(financialYear), {
    title: `Car logbook FY ${financialYearLabel(financialYear)}`,
  });
}

/** Saves a backup file. Counts as backed up once it leaves the app. */
export async function saveBackup() {
  const { blob, filename } = await buildBackupFile();
  const result = await shareOrDownload(blob, filename, {
    title: 'Car Logbook backup',
  });
  if (result !== 'cancelled') await markBackedUp();
  return result;
}
