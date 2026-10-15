/**
 * Dates, Australian style: DD/MM/YYYY and a 1 July - 30 June financial year.
 *
 * Everything is stored as an ISO-8601 instant and rendered in the device's
 * local zone, which for this app is always the zone the trip happened in.
 */

const DTF_DATE = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DTF_DATETIME = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DTF_TIME = new Intl.DateTimeFormat('en-AU', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DTF_LONG = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function toDate(value) {
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = toDate(value);
  return d ? DTF_DATE.format(d) : '—';
}

export function formatDateTime(value) {
  const d = toDate(value);
  return d ? DTF_DATETIME.format(d).replace(',', '') : '—';
}

export function formatTime(value) {
  const d = toDate(value);
  return d ? DTF_TIME.format(d) : '—';
}

export function formatLongDate(value) {
  const d = toDate(value);
  return d ? DTF_LONG.format(d) : '—';
}

/** "3 days ago", "Today", "12/03/2026" for anything older than a fortnight. */
export function formatRelative(value) {
  const d = toDate(value);
  if (!d) return 'Never';
  const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return `Today at ${formatTime(d)}`;
  if (days === 1) return `Yesterday at ${formatTime(d)}`;
  if (days < 14) return `${days} days ago`;
  return formatDate(d);
}

export function startOfDay(value) {
  const d = toDate(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days between two instants, counted on calendar-day boundaries. */
export function daysBetween(from, to) {
  const a = startOfDay(from);
  const b = startOfDay(to);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Australian financial year: 1 July to 30 June.
 * A date in July 2026 belongs to FY 2026-27, whose startYear is 2026.
 */
export function financialYearOf(value) {
  const d = toDate(value) || new Date();
  const year = d.getFullYear();
  // getMonth() is zero-based, so 6 === July.
  return d.getMonth() >= 6 ? year : year - 1;
}

export function currentFinancialYear() {
  return financialYearOf(new Date());
}

export function financialYearRange(startYear) {
  return {
    start: new Date(startYear, 6, 1, 0, 0, 0, 0),
    // Exclusive upper bound: midnight at the start of 1 July next year.
    end: new Date(startYear + 1, 6, 1, 0, 0, 0, 0),
  };
}

/** "2026-27" */
export function financialYearLabel(startYear) {
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${end}`;
}

export function isInFinancialYear(value, startYear) {
  const d = toDate(value);
  if (!d) return false;
  const { start, end } = financialYearRange(startYear);
  return d >= start && d < end;
}

/** Compact stamp for backup filenames: 2026-10-15-1432 */
export function fileStamp(value = new Date()) {
  const d = toDate(value) || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  );
}
