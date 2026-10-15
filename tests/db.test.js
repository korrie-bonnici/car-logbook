import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each test gets an empty database and a fresh copy of the modules, so the
// cached connection in db.js never leaks between tests.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

/** Builds a database exactly as the first version of the app left it. */
function seedVersionOne(trips) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('car-logbook', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('trips', { keyPath: 'id' }).createIndex('byStartedAt', 'start.at');
      db.createObjectStore('periods', { keyPath: 'id' }).createIndex('byStartedAt', 'start.at');
      db.createObjectStore('photos', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
      for (const trip of trips) request.transaction.objectStore('trips').put(trip);
      request.transaction.objectStore('photos').put({ id: 'p1', blob: 'jpeg' });
      request.transaction.objectStore('meta').put({ key: 'backupPending', value: true });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

describe('upgrading from the first version', () => {
  it('keeps trips, drops their photos, and removes the photo and period stores', async () => {
    await seedVersionOne([
      {
        id: 'old',
        business: true,
        notes: 'Client meeting',
        start: { odometer: 100, at: '2026-07-01T09:00:00.000Z', photoId: 'p1' },
        end: { odometer: 112, at: '2026-07-01T10:00:00.000Z', photoId: 'p2' },
        createdAt: '2026-07-01T09:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ]);

    const db = await import('../src/lib/db.js');
    const trips = await db.getAllTrips();

    expect(trips).toEqual([
      {
        id: 'old',
        purpose: 'Client meeting',
        start: { odometer: 100, at: '2026-07-01T09:00:00.000Z' },
        end: { odometer: 112, at: '2026-07-01T10:00:00.000Z' },
        createdAt: '2026-07-01T09:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    ]);
    expect([...(await db.storeNames())].sort()).toEqual(['meta', 'trips']);
    expect(await db.getMeta('backupPending')).toBeNull();
  });
});

describe('trip lifecycle', () => {
  it('records a start, then an end with a purpose', async () => {
    const logbook = await import('../src/lib/logbook.js');
    const started = await logbook.startTrip({ odometer: 48210, at: '2026-10-15T09:14:00.000Z' });

    expect((await logbook.loadState()).openTrip.id).toBe(started.id);

    await logbook.endTrip(started.id, {
      odometer: 48222,
      at: '2026-10-15T09:35:00.000Z',
      purpose: '  Site visit  ',
    });

    const { trips, openTrip, latestOdometer } = await logbook.loadState();
    expect(openTrip).toBeNull();
    expect(latestOdometer).toBe(48222);
    expect(trips[0]).toMatchObject({
      purpose: 'Site visit',
      start: { odometer: 48210 },
      end: { odometer: 48222, at: '2026-10-15T09:35:00.000Z' },
    });
  });

  it('refuses to start a second trip while one is open', async () => {
    const logbook = await import('../src/lib/logbook.js');
    await logbook.startTrip({ odometer: 1000 });
    await expect(logbook.startTrip({ odometer: 1000 })).rejects.toThrow(/already/);
  });

  it('discards an open trip', async () => {
    const logbook = await import('../src/lib/logbook.js');
    const started = await logbook.startTrip({ odometer: 1000 });
    await logbook.cancelTrip(started.id);
    expect((await logbook.loadState()).trips).toEqual([]);
  });
});

describe('restore', () => {
  it('replaces every trip and records the backup time', async () => {
    const logbook = await import('../src/lib/logbook.js');
    const backup = await import('../src/lib/backup.js');
    await logbook.startTrip({ odometer: 1 });

    const restoredTrip = {
      id: 'r',
      purpose: 'Restored',
      start: { odometer: 5, at: '2026-07-01T09:00:00.000Z' },
      end: { odometer: 9, at: '2026-07-01T10:00:00.000Z' },
      createdAt: '2026-07-01T09:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    };
    await backup.applyRestore({ trips: [restoredTrip], exportedAt: '2026-07-02T00:00:00.000Z' });

    const db = await import('../src/lib/db.js');
    expect(await db.getAllTrips()).toEqual([restoredTrip]);
    expect(await db.getMeta(backup.META_LAST_BACKUP_AT)).toBe('2026-07-02T00:00:00.000Z');
  });
});
