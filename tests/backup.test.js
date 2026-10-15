import { describe, expect, it } from 'vitest';
import {
  BackupFormatError,
  backupReminder,
  buildBackupPayload,
  parseBackup,
} from '../src/lib/backup.js';

const trip = {
  id: 't1',
  purpose: 'Site visit',
  start: { odometer: 100, at: '2026-07-01T09:00:00.000Z' },
  end: { odometer: 112, at: '2026-07-01T10:00:00.000Z' },
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
};

describe('backup round trip', () => {
  it('restores exactly what it saved', () => {
    const payload = buildBackupPayload([trip], new Date('2026-07-02T00:00:00Z'));
    const parsed = parseBackup(JSON.stringify(payload));
    expect(parsed).toEqual({ trips: [trip], exportedAt: '2026-07-02T00:00:00.000Z' });
  });
});

describe('parseBackup', () => {
  it('reads a backup from the first version, dropping photos and periods', () => {
    const v1 = {
      app: 'car-logbook',
      schemaVersion: 1,
      exportedAt: '2026-07-02T00:00:00.000Z',
      trips: [{ ...trip, purpose: undefined, notes: 'Site visit', business: true }],
      periods: [{ id: 'p' }],
      photos: [{ id: 'x', data: 'AAAA' }],
      meta: [],
    };
    expect(parseBackup(JSON.stringify(v1)).trips).toEqual([trip]);
  });

  it('rejects something that is not JSON', () => {
    expect(() => parseBackup('not json')).toThrow(BackupFormatError);
  });

  it('rejects another app’s file', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'other', trips: [] }))).toThrow(
      BackupFormatError,
    );
  });

  it('rejects a backup from a newer version of the app', () => {
    const newer = { app: 'car-logbook', schemaVersion: 99, trips: [] };
    expect(() => parseBackup(JSON.stringify(newer))).toThrow(/newer version/);
  });

  it('rejects a damaged trip instead of restoring it', () => {
    const damaged = { app: 'car-logbook', schemaVersion: 2, trips: [{ id: 'x' }] };
    expect(() => parseBackup(JSON.stringify(damaged))).toThrow(BackupFormatError);
  });
});

describe('backupReminder', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('stays quiet with no trips', () => {
    expect(backupReminder({ trips: [], lastBackupAt: null, now }).show).toBe(false);
  });

  it('nudges when trips have never been backed up', () => {
    expect(backupReminder({ trips: [trip], lastBackupAt: null, now })).toEqual({
      show: true,
      unsaved: 1,
    });
  });

  it('waits for a trip in progress to finish before nudging', () => {
    const open = { ...trip, end: null };
    expect(backupReminder({ trips: [open], lastBackupAt: null, now })).toEqual({
      show: false,
      unsaved: 0,
    });
  });

  it('stays quiet for a recent backup even with new trips', () => {
    const lastBackupAt = '2026-10-01T00:00:00.000Z';
    const fresh = { ...trip, updatedAt: '2026-10-10T00:00:00.000Z' };
    expect(backupReminder({ trips: [fresh], lastBackupAt, now })).toEqual({
      show: false,
      unsaved: 1,
    });
  });

  it('nudges when the last backup is over 30 days old and trips changed since', () => {
    const lastBackupAt = '2026-09-01T00:00:00.000Z';
    const fresh = { ...trip, updatedAt: '2026-10-10T00:00:00.000Z' };
    expect(backupReminder({ trips: [fresh], lastBackupAt, now }).show).toBe(true);
  });

  it('stays quiet for an old backup when nothing changed since', () => {
    const lastBackupAt = '2026-08-01T00:00:00.000Z';
    expect(backupReminder({ trips: [trip], lastBackupAt, now }).show).toBe(false);
  });
});
