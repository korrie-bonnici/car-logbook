/**
 * CSV export for the accountant, and the Web Share fallback for backups.
 */
import { financialYearLabel, formatDate, formatTime } from './dates.js';
import { tripKm, tripsInFinancialYear } from './logbook.js';
import { buildBackupBlob, markBackedUp } from './backup.js';

/* ------------------------------------------------------------------ CSV -- */

const COLUMNS = [
  'Date',
  'Start time',
  'End time',
  'Start odometer (km)',
  'End odometer (km)',
  'Distance (km)',
  'Purpose',
  'Use',
];

/**
 * Escapes a CSV field. Excel treats a leading =, +, - or @ as a formula, so
 * those get a leading apostrophe. Trip purposes are free text and could
 * otherwise be interpreted as one.
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
        trip.notes || '',
        trip.business ? 'Business' : 'Private',
      ]),
    );
  }

  const businessKm = rows
    .filter((t) => t.business)
    .reduce((sum, t) => sum + tripKm(t), 0);
  const privateKm = rows
    .filter((t) => !t.business)
    .reduce((sum, t) => sum + tripKm(t), 0);
  const totalKm = businessKm + privateKm;

  lines.push('');
  lines.push(csvRow(['Financial year', financialYearLabel(financialYear)]));
  lines.push(csvRow(['Trips', rows.length]));
  lines.push(csvRow(['Business km', businessKm]));
  lines.push(csvRow(['Private km', privateKm]));
  lines.push(csvRow(['Total km', totalKm]));
  lines.push(
    csvRow([
      'Business use',
      totalKm > 0 ? `${((businessKm / totalKm) * 100).toFixed(1)}%` : 'n/a',
    ]),
  );

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
 * Offers a blob to the user: the Android share sheet where available,
 * otherwise a plain download.
 * Returns 'shared', 'downloaded' or 'cancelled'.
 */
export async function shareOrDownload(blob, filename, { title, text } = {}) {
  if (canShareFiles()) {
    const file = new File([blob], filename, { type: blob.type });
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (err) {
      // AbortError means the user dismissed the sheet, which is not a failure.
      if (err?.name === 'AbortError') return 'cancelled';
      // Anything else: fall through to a download rather than dead-end.
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
  const csv = buildCsv(trips, financialYear);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  return shareOrDownload(blob, csvFilename(financialYear), {
    title: `Car logbook FY ${financialYearLabel(financialYear)}`,
    text: 'Vehicle logbook export for the financial year.',
  });
}

/** Share-sheet backup. Counts as a real backup once it leaves the app. */
export async function shareBackup() {
  const { blob, filename } = await buildBackupBlob();
  const result = await shareOrDownload(blob, filename, {
    title: 'Car Logbook backup',
    text: 'Car Logbook backup file. Save this somewhere safe.',
  });
  if (result !== 'cancelled') await markBackedUp('share');
  return result;
}
