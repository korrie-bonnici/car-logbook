/**
 * Trip rules: validation, distances and financial-year totals.
 *
 * Pure functions only, no storage and no DOM, so every rule here is covered
 * by tests/trip.test.js.
 *
 * A trip looks like:
 *   { id, purpose, start: { odometer, at }, end: { odometer, at } | null,
 *     createdAt, updatedAt }
 * and is "open" while `end` is null.
 */
import { financialYearOf, isInFinancialYear } from './dates.js';

/** A single trip longer than this is more likely a misread digit. */
export const LONG_TRIP_WARNING_KM = 500;

/**
 * A start this far above the last reading is more likely a misread digit
 * than private driving. Private driving between business trips is normal,
 * so the bar is high.
 */
export const BIG_GAP_WARNING_KM = 10_000;

export const MAX_ODOMETER = 9_999_999;
export const PURPOSE_MAX_LENGTH = 500;

/* ----------------------------------------------------------- validation -- */

/** One odometer reading in isolation. Returns { ok, error }. */
export function validateReading(value) {
  if (value === '' || value === null || value === undefined) {
    return { ok: false, error: 'Enter the odometer reading.' };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: 'That is not a number.' };
  if (!Number.isInteger(n)) return { ok: false, error: 'Use whole kilometres.' };
  if (n < 0) return { ok: false, error: 'A reading cannot be negative.' };
  if (n > MAX_ODOMETER) return { ok: false, error: 'That reading is too large.' };
  return { ok: true, error: null };
}

/**
 * A start reading checked against history. `errors` block saving;
 * `warnings` are shown once and can then be accepted.
 */
export function validateStart(value, { latestOdometer }) {
  const base = validateReading(value);
  if (!base.ok) return { ok: false, errors: [base.error], warnings: [] };

  const n = Number(value);
  const errors = [];
  const warnings = [];

  if (Number.isFinite(latestOdometer) && n < latestOdometer) {
    errors.push(
      `Start cannot be below your last recorded reading of ${formatKm(latestOdometer)} km.`,
    );
  } else if (Number.isFinite(latestOdometer) && n - latestOdometer > BIG_GAP_WARNING_KM) {
    warnings.push(
      `That is ${formatKm(n - latestOdometer)} km above your last recorded reading. ` +
        'Check the number against the photo.',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** An end reading checked against the trip's own start. */
export function validateEnd(value, { startOdometer }) {
  const base = validateReading(value);
  if (!base.ok) return { ok: false, errors: [base.error], warnings: [] };

  const n = Number(value);
  const errors = [];
  const warnings = [];

  if (n <= startOdometer) {
    errors.push(`End must be higher than the start reading of ${formatKm(startOdometer)} km.`);
  } else if (n - startOdometer > LONG_TRIP_WARNING_KM) {
    warnings.push(
      `That is a ${formatKm(n - startOdometer)} km trip. Check the number against the photo.`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** The ATO wants a reason recorded for every business trip. */
export function validatePurpose(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter the purpose of this trip. The ATO requires one.' };
  }
  if (trimmed.length > PURPOSE_MAX_LENGTH) {
    return { ok: false, error: `Keep the purpose under ${PURPOSE_MAX_LENGTH} characters.` };
  }
  return { ok: true, error: null };
}

/* -------------------------------------------------------------- totals -- */

export function isComplete(trip) {
  return Boolean(trip?.end);
}

export function tripKm(trip) {
  if (!trip?.end || !Number.isFinite(trip.end.odometer)) return 0;
  if (!Number.isFinite(trip?.start?.odometer)) return 0;
  return Math.max(0, trip.end.odometer - trip.start.odometer);
}

/** Highest reading on record, open trip included; null with no trips. */
export function latestOdometer(trips) {
  let highest = null;
  for (const trip of trips) {
    for (const reading of [trip?.start, trip?.end]) {
      if (Number.isFinite(reading?.odometer) && (highest === null || reading.odometer > highest)) {
        highest = reading.odometer;
      }
    }
  }
  return highest;
}

/** Completed trips in one financial year, oldest first. */
export function tripsInFinancialYear(trips, startYear) {
  return trips
    .filter((t) => isComplete(t) && isInFinancialYear(t.start.at, startYear))
    .sort((a, b) => new Date(a.start.at) - new Date(b.start.at));
}

/** Financial years that contain completed trips, newest first. */
export function financialYearsWithTrips(trips) {
  const years = new Set();
  for (const trip of trips) {
    if (isComplete(trip)) years.add(financialYearOf(trip.start.at));
  }
  return [...years].sort((a, b) => b - a);
}

export function summarise(trips, financialYear) {
  const rows = tripsInFinancialYear(trips, financialYear);
  return {
    financialYear,
    km: rows.reduce((sum, t) => sum + tripKm(t), 0),
    tripCount: rows.length,
  };
}

/* ------------------------------------------------------------ migration -- */

/**
 * Brings a stored or restored trip into the current shape, and throws when
 * it is too damaged to trust. Safe to run more than once.
 *
 * The first version of the app kept photos and a Business/Private flag. The
 * photo ids are dropped, and an old private trip keeps its record with
 * "Private:" in front of the purpose so it can be found and deleted.
 */
export function normaliseTrip(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) {
    throw new TypeError('A trip has no id.');
  }
  const start = normaliseReading(raw.start);
  if (!start) throw new TypeError('A trip has no valid start reading.');

  const end = raw.end ? normaliseReading(raw.end) : null;
  if (raw.end && !end) throw new TypeError('A trip has a damaged end reading.');

  let purpose = String(raw.purpose ?? raw.notes ?? '').trim();
  if (raw.business === false) purpose = purpose ? `Private: ${purpose}` : 'Private';

  const createdAt = raw.createdAt || start.at;
  return {
    id: raw.id,
    purpose,
    start,
    end,
    createdAt,
    updatedAt: raw.updatedAt || createdAt,
  };
}

function normaliseReading(reading) {
  if (!reading || !Number.isFinite(reading.odometer)) return null;
  if (typeof reading.at !== 'string' || Number.isNaN(new Date(reading.at).getTime())) {
    return null;
  }
  return { odometer: reading.odometer, at: reading.at };
}

/* ---------------------------------------------------------------- utils -- */

export function formatKm(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU').format(Math.round(value));
}
