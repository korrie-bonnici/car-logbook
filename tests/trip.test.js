import { describe, expect, it } from 'vitest';
import {
  financialYearsWithTrips,
  latestOdometer,
  normaliseTrip,
  summarise,
  tripKm,
  tripsInFinancialYear,
  validateEnd,
  validatePurpose,
  validateReading,
  validateStart,
} from '../src/lib/trip.js';

function trip(id, startKm, endKm, startAt, purpose = 'Site visit') {
  return {
    id,
    start: { odometer: startKm, at: startAt },
    end: endKm === null ? null : { odometer: endKm, at: startAt },
    purpose,
  };
}

describe('tripKm', () => {
  it('is the end reading minus the start reading', () => {
    expect(tripKm(trip('a', 48210, 48222, '2026-10-01T09:00:00'))).toBe(12);
  });

  it('is zero for a trip still in progress', () => {
    expect(tripKm(trip('a', 48210, null, '2026-10-01T09:00:00'))).toBe(0);
  });
});

describe('validateReading', () => {
  it('requires a value', () => {
    expect(validateReading('').ok).toBe(false);
  });

  it('accepts whole kilometres', () => {
    expect(validateReading('48210').ok).toBe(true);
  });

  it('rejects decimals', () => {
    expect(validateReading('48210.5').ok).toBe(false);
  });
});

describe('validateStart', () => {
  it('blocks a start below the last recorded reading', () => {
    const result = validateStart('48000', { latestOdometer: 48210 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/48,210/);
  });

  it('allows private driving between business trips without a warning', () => {
    const result = validateStart('51000', { latestOdometer: 48210 });
    expect(result).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('warns about a gap so large it is probably a misread digit', () => {
    const result = validateStart('482100', { latestOdometer: 48210 });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('accepts anything valid when there is no history', () => {
    expect(validateStart('48210', { latestOdometer: null }).ok).toBe(true);
  });
});

describe('validateEnd', () => {
  it('must be above the start reading', () => {
    expect(validateEnd('48210', { startOdometer: 48210 }).ok).toBe(false);
  });

  it('accepts a normal trip', () => {
    expect(validateEnd('48222', { startOdometer: 48210 })).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  it('warns about a very long trip', () => {
    const result = validateEnd('48900', { startOdometer: 48210 });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('validatePurpose', () => {
  it('requires a purpose', () => {
    expect(validatePurpose('   ').ok).toBe(false);
  });

  it('accepts a short description', () => {
    expect(validatePurpose('Site visit, Bunnings Parramatta').ok).toBe(true);
  });

  it('rejects an essay', () => {
    expect(validatePurpose('x'.repeat(501)).ok).toBe(false);
  });
});

describe('financial years', () => {
  const trips = [
    trip('june', 100, 110, '2026-06-30T23:30:00'),
    trip('july', 110, 125, '2026-07-01T00:30:00'),
    trip('aug', 125, 130, '2026-08-15T10:00:00'),
    trip('open', 130, null, '2026-09-01T10:00:00'),
  ];

  it('puts 30 June and 1 July in different years', () => {
    expect(tripsInFinancialYear(trips, 2025).map((t) => t.id)).toEqual(['june']);
    expect(tripsInFinancialYear(trips, 2026).map((t) => t.id)).toEqual(['july', 'aug']);
  });

  it('lists years that have completed trips, newest first', () => {
    expect(financialYearsWithTrips(trips)).toEqual([2026, 2025]);
  });

  it('totals km and trips for one year, ignoring the open trip', () => {
    expect(summarise(trips, 2026)).toEqual({ financialYear: 2026, km: 20, tripCount: 2 });
  });
});

describe('latestOdometer', () => {
  it('is the highest reading anywhere, including an open trip', () => {
    const trips = [trip('a', 100, 110, '2026-07-01'), trip('b', 150, null, '2026-07-02')];
    expect(latestOdometer(trips)).toBe(150);
  });

  it('is null with no trips', () => {
    expect(latestOdometer([])).toBeNull();
  });
});

describe('normaliseTrip', () => {
  const v1 = {
    id: 'abc',
    business: true,
    notes: 'Client meeting',
    start: { odometer: 100, at: '2026-07-01T09:00:00.000Z', photoId: 'p1' },
    end: { odometer: 112, at: '2026-07-01T10:00:00.000Z', photoId: 'p2' },
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  };

  it('turns an old trip into the new shape', () => {
    expect(normaliseTrip(v1)).toEqual({
      id: 'abc',
      purpose: 'Client meeting',
      start: { odometer: 100, at: '2026-07-01T09:00:00.000Z' },
      end: { odometer: 112, at: '2026-07-01T10:00:00.000Z' },
      createdAt: '2026-07-01T09:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    });
  });

  it('labels an old private trip so it can be found and removed', () => {
    expect(normaliseTrip({ ...v1, business: false }).purpose).toBe('Private: Client meeting');
  });

  it('is unchanged by a second pass', () => {
    const once = normaliseTrip({ ...v1, business: false });
    expect(normaliseTrip(once)).toEqual(once);
  });

  it('keeps an open trip open', () => {
    expect(normaliseTrip({ ...v1, end: null }).end).toBeNull();
  });

  it('rejects a trip with no start reading', () => {
    expect(() => normaliseTrip({ id: 'x', start: null })).toThrow();
  });
});
