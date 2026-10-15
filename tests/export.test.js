import { describe, expect, it } from 'vitest';
import { buildCsv, csvFilename } from '../src/lib/export.js';

function trip(id, startKm, endKm, startAt, endAt, purpose) {
  return {
    id,
    purpose,
    start: { odometer: startKm, at: startAt },
    end: { odometer: endKm, at: endAt },
  };
}

const trips = [
  trip('b', 48222, 48240, '2026-08-02T14:05:00', '2026-08-02T14:40:00', 'Supplier, Smith St'),
  trip('a', 48210, 48222, '2026-08-01T09:14:00', '2026-08-01T09:35:00', '=SUM(A1)'),
  trip('old', 100, 110, '2026-06-30T09:00:00', '2026-06-30T09:30:00', 'Last FY'),
];

function lines(csv) {
  return csv.replace(/^﻿/, '').trim().split('\r\n');
}

describe('buildCsv', () => {
  const csv = buildCsv(trips, 2026);

  it('starts with a BOM so Excel reads it as UTF-8', () => {
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('lists that year’s trips oldest first, one row each', () => {
    const rows = lines(csv);
    expect(rows[0]).toBe(
      'Date,Start time,End time,Start odometer (km),End odometer (km),Distance (km),Purpose',
    );
    expect(rows[1]).toBe("01/08/2026,09:14,09:35,48210,48222,12,'=SUM(A1)");
    expect(rows[2]).toBe('02/08/2026,14:05,14:40,48222,48240,18,"Supplier, Smith St"');
  });

  it('ends with the year totals', () => {
    const rows = lines(csv);
    expect(rows.slice(-3)).toEqual([
      'Financial year,2026-27',
      'Trips,2',
      'Total business km,30',
    ]);
  });
});

describe('csvFilename', () => {
  it('names the financial year', () => {
    expect(csvFilename(2026)).toBe('car-logbook-FY2026-27.csv');
  });
});
