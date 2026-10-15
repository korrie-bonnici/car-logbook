/**
 * Logbook domain rules: validation, trip lifecycle and the totals the home
 * screen reports. Nothing here touches the DOM.
 */
import {
  deleteTrip,
  getAllPeriods,
  getAllTrips,
  getLatestOdometer,
  getOpenPeriod,
  getOpenTrip,
  getTrip,
  newId,
  putPeriod,
  putTrip,
} from './db.js';
import {
  currentFinancialYear,
  daysBetween,
  financialYearOf,
  isInFinancialYear,
} from './dates.js';

/** A single trip over this is almost always a typo in the odometer reading. */
export const LONG_TRIP_WARNING_KM = 1000;

export const MAX_ODOMETER = 9_999_999;

/* ----------------------------------------------------------- validation -- */

/**
 * Validates one odometer reading in isolation.
 * Returns { ok, error } — error is a sentence fit to show the user.
 */
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
 * Checks a proposed start reading against history.
 *
 * `errors` block saving. `warnings` are shown but can be accepted, because a
 * legitimate reason exists for each of them (a replaced instrument cluster,
 * a trip someone forgot to log).
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
  } else if (Number.isFinite(latestOdometer) && n - latestOdometer > LONG_TRIP_WARNING_KM) {
    warnings.push(
      `That is ${formatKm(n - latestOdometer)} km above your last recorded reading. ` +
        'Unlogged driving in between is fine, just check the number.',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Checks a proposed end reading against the trip's own start. */
export function validateEnd(value, { startOdometer }) {
  const base = validateReading(value);
  if (!base.ok) return { ok: false, errors: [base.error], warnings: [] };

  const n = Number(value);
  const errors = [];
  const warnings = [];

  if (!Number.isFinite(startOdometer)) {
    errors.push('This trip has no start reading.');
    return { ok: false, errors, warnings };
  }

  if (n <= startOdometer) {
    errors.push(
      `End must be higher than the start reading of ${formatKm(startOdometer)} km.`,
    );
  } else if (n - startOdometer > LONG_TRIP_WARNING_KM) {
    warnings.push(
      `That is a ${formatKm(n - startOdometer)} km trip. ` +
        'Check the reading before saving.',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Trip purpose is required: the ATO wants a reason recorded per trip. */
export function validateNotes(notes) {
  const text = String(notes || '').trim();
  if (!text) {
    return { ok: false, error: 'Enter the purpose of this trip. The ATO requires one.' };
  }
  if (text.length > 500) {
    return { ok: false, error: 'Keep the purpose under 500 characters.' };
  }
  return { ok: true, error: null };
}

/* ------------------------------------------------------- trip lifecycle -- */

export async function startTrip({ odometer, at, photoId, business = true }) {
  const existing = await getOpenTrip();
  if (existing) throw new Error('A trip is already in progress.');

  const trip = {
    id: newId(),
    business: Boolean(business),
    notes: '',
    start: {
      odometer: Number(odometer),
      at: at || new Date().toISOString(),
      photoId: photoId || null,
    },
    end: null,
    createdAt: new Date().toISOString(),
  };
  return putTrip(trip);
}

export async function endTrip(tripId, { odometer, at, photoId, notes, business }) {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error('That trip no longer exists.');
  if (trip.end) throw new Error('That trip is already finished.');

  const updated = {
    ...trip,
    business: business === undefined ? trip.business : Boolean(business),
    notes: String(notes || '').trim(),
    end: {
      odometer: Number(odometer),
      at: at || new Date().toISOString(),
      photoId: photoId || null,
    },
  };
  return putTrip(updated);
}

/** Abandons an open trip and its start photo. */
export async function cancelTrip(tripId) {
  const trip = await getTrip(tripId);
  if (!trip) return;
  if (trip.end) throw new Error('That trip is finished and cannot be cancelled.');
  await deleteTrip(tripId);
}

export async function updateTrip(tripId, changes) {
  const trip = await getTrip(tripId);
  if (!trip) throw new Error('That trip no longer exists.');
  return putTrip({ ...trip, ...changes, id: trip.id });
}

/* ----------------------------------------------------- logbook periods -- */

export async function startPeriod({ odometer, at, photoId }) {
  const existing = await getOpenPeriod();
  if (existing) throw new Error('A logbook period is already running.');

  const period = {
    id: newId(),
    start: {
      odometer: Number(odometer),
      at: at || new Date().toISOString(),
      photoId: photoId || null,
    },
    end: null,
    createdAt: new Date().toISOString(),
  };
  return putPeriod(period);
}

export async function endPeriod(periodId, { odometer, at, photoId }) {
  const periods = await getAllPeriods();
  const period = periods.find((p) => p.id === periodId);
  if (!period) throw new Error('That logbook period no longer exists.');
  if (period.end) throw new Error('That logbook period is already closed.');

  return putPeriod({
    ...period,
    end: {
      odometer: Number(odometer),
      at: at || new Date().toISOString(),
      photoId: photoId || null,
    },
  });
}

/**
 * Business use over a period, the figure that goes on the tax return.
 *
 * Total km comes from the odometer difference across the period, so private
 * driving counts even when it was never logged as a trip. Business km is the
 * sum of trips flagged business whose start falls inside the period. That is
 * how the ATO logbook method works.
 */
export function summarisePeriod(period, trips) {
  const startAt = period?.start?.at ? new Date(period.start.at) : null;
  const endAt = period?.end?.at ? new Date(period.end.at) : new Date();
  const open = !period?.end;

  const inPeriod = trips.filter((t) => {
    if (!t?.start?.at || !t.end) return false;
    const at = new Date(t.start.at);
    return startAt && at >= startAt && at <= endAt;
  });

  const businessKm = inPeriod
    .filter((t) => t.business)
    .reduce((sum, t) => sum + tripKm(t), 0);

  const loggedKm = inPeriod.reduce((sum, t) => sum + tripKm(t), 0);

  const totalKm = period?.end
    ? Math.max(0, period.end.odometer - period.start.odometer)
    : loggedKm;

  const businessPercent = totalKm > 0 ? (businessKm / totalKm) * 100 : null;

  return {
    open,
    days: startAt ? daysBetween(startAt, endAt) + 1 : 0,
    businessKm,
    privateKm: Math.max(0, totalKm - businessKm),
    totalKm,
    loggedKm,
    tripCount: inPeriod.length,
    businessPercent,
    // The ATO wants at least 12 continuous weeks.
    meetsTwelveWeeks: startAt ? daysBetween(startAt, endAt) + 1 >= 84 : false,
  };
}

/* --------------------------------------------------------------- totals -- */

export function tripKm(trip) {
  if (!trip?.end || !Number.isFinite(trip.end.odometer)) return 0;
  if (!Number.isFinite(trip?.start?.odometer)) return 0;
  return Math.max(0, trip.end.odometer - trip.start.odometer);
}

export function isComplete(trip) {
  return Boolean(trip?.end);
}

/**
 * Everything the home screen shows, computed in one pass.
 */
export function summarise(trips, financialYear = currentFinancialYear()) {
  const completed = trips.filter(isComplete);

  let fyBusinessKm = 0;
  let fyPrivateKm = 0;
  let fyTripCount = 0;
  let allTimeKm = 0;
  let allTimeBusinessKm = 0;

  for (const trip of completed) {
    const km = tripKm(trip);
    allTimeKm += km;
    if (trip.business) allTimeBusinessKm += km;

    if (isInFinancialYear(trip.start.at, financialYear)) {
      fyTripCount += 1;
      if (trip.business) fyBusinessKm += km;
      else fyPrivateKm += km;
    }
  }

  return {
    financialYear,
    fyBusinessKm,
    fyPrivateKm,
    fyTotalKm: fyBusinessKm + fyPrivateKm,
    fyTripCount,
    allTimeKm,
    allTimeBusinessKm,
    tripCount: completed.length,
    openCount: trips.length - completed.length,
  };
}

/** Financial years that actually contain trips, newest first. */
export function financialYearsWithTrips(trips) {
  const years = new Set();
  for (const trip of trips) {
    if (isComplete(trip) && trip?.start?.at) years.add(financialYearOf(trip.start.at));
  }
  return [...years].sort((a, b) => b - a);
}

export function tripsInFinancialYear(trips, startYear) {
  return trips
    .filter((t) => isComplete(t) && isInFinancialYear(t.start.at, startYear))
    .sort((a, b) => new Date(a.start.at) - new Date(b.start.at));
}

/* ---------------------------------------------------------------- utils -- */

export function formatKm(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU').format(Math.round(value));
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Convenience wrapper used by views that need the whole picture at once. */
export async function loadState() {
  const [trips, periods, openTrip, openPeriod, latestOdometer] = await Promise.all([
    getAllTrips(),
    getAllPeriods(),
    getOpenTrip(),
    getOpenPeriod(),
    getLatestOdometer(),
  ]);
  return { trips, periods, openTrip, openPeriod, latestOdometer };
}
