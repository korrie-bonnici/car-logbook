/**
 * Home: open trip status, the headline numbers and the primary actions.
 */
import { financialYearLabel, formatDateTime, formatRelative } from '../lib/dates.js';
import {
  cancelTrip,
  formatKm,
  formatPercent,
  loadState,
  summarise,
  summarisePeriod,
} from '../lib/logbook.js';
import { getMeta } from '../lib/db.js';
import {
  META_LAST_BACKUP_AT,
  META_LAST_BACKUP_TARGET,
  META_PENDING_BACKUP,
} from '../lib/backup.js';
import { isDriveConfigured } from '../lib/config.js';
import { hasValidToken, backupToDrive } from '../lib/drive.js';
import { shareBackup, canShareFiles } from '../lib/export.js';
import {
  endPeriodFlow,
  endTripFlow,
  startPeriodFlow,
  startTripFlow,
} from '../lib/actions.js';
import { h, toast, withBusy, confirmDialog } from '../lib/ui.js';

export async function renderHome({ navigate, refresh }) {
  const [{ trips, periods, openTrip, openPeriod }, lastBackupAt, lastTarget, pending] =
    await Promise.all([
      loadState(),
      getMeta(META_LAST_BACKUP_AT),
      getMeta(META_LAST_BACKUP_TARGET),
      getMeta(META_PENDING_BACKUP, false),
    ]);

  const totals = summarise(trips);
  const view = h('div', { class: 'view view--home' });

  view.appendChild(
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Car Logbook'),
      h(
        'p',
        { class: 'page-sub' },
        `Financial year ${financialYearLabel(totals.financialYear)}`,
      ),
    ),
  );

  /* ----------------------------------------------------- backup banner */

  const needsBackup = Boolean(pending) && totals.tripCount > 0;
  if (needsBackup) {
    view.appendChild(renderBackupBanner({ refresh }));
  }

  /* -------------------------------------------------------- trip state */

  view.appendChild(renderTripCard({ openTrip, refresh }));

  /* ------------------------------------------------------------ totals */

  view.appendChild(
    h(
      'section',
      { class: 'stats', 'aria-label': 'Summary' },
      stat(
        'Business km',
        formatKm(totals.fyBusinessKm),
        `FY ${financialYearLabel(totals.financialYear)}`,
        'primary',
      ),
      stat('Trips', formatKm(totals.fyTripCount), 'This financial year'),
      stat('All-time km', formatKm(totals.allTimeKm), `${totals.tripCount} trips logged`),
      stat(
        'Last backed up',
        lastBackupAt ? formatRelative(lastBackupAt) : 'Never',
        lastBackupAt
          ? lastTarget === 'drive'
            ? 'Google Drive'
            : 'Shared file'
          : 'No backup yet',
        lastBackupAt ? '' : 'muted',
      ),
    ),
  );

  /* --------------------------------------------------- logbook period */

  view.appendChild(renderPeriodCard({ openPeriod, periods, trips, refresh }));

  /* -------------------------------------------------------- shortcuts */

  view.appendChild(
    h(
      'section',
      { class: 'card card--quiet' },
      h('h2', { class: 'card__title' }, 'Records'),
      h(
        'div',
        { class: 'stack' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary btn--block',
            onclick: () => navigate('trips'),
          },
          `View all trips (${totals.tripCount})`,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary btn--block',
            onclick: () => navigate('settings'),
          },
          'Backup, export and settings',
        ),
      ),
    ),
  );

  return view;
}

/* ------------------------------------------------------------ sections -- */

function renderTripCard({ openTrip, refresh }) {
  if (openTrip) {
    const since = formatDateTime(openTrip.start.at);
    return h(
      'section',
      { class: 'card card--active' },
      h(
        'div',
        { class: 'card__flag' },
        h('span', { class: 'pulse', 'aria-hidden': 'true' }),
        'Trip in progress',
      ),
      h(
        'dl',
        { class: 'readout' },
        readoutRow('Started', since),
        readoutRow('Start reading', `${formatKm(openTrip.start.odometer)} km`),
        readoutRow('Type', openTrip.business === false ? 'Private' : 'Business'),
      ),
      h(
        'div',
        { class: 'stack' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--primary btn--xl btn--block',
            onclick: async (event) => {
              await withBusy(event.currentTarget, 'Opening camera…', async () => {
                const done = await endTripFlow(openTrip);
                if (done) await refresh();
              });
            },
          },
          'End trip',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--block',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Discard this trip?',
                body:
                  'The start reading and its photo will be deleted. ' +
                  'This cannot be undone.',
                confirmLabel: 'Discard trip',
                destructive: true,
              });
              if (!ok) return;
              await cancelTrip(openTrip.id);
              toast('Trip discarded.');
              await refresh();
            },
          },
          'Discard trip',
        ),
      ),
    );
  }

  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'No trip in progress'),
    h(
      'p',
      { class: 'card__text' },
      'Photograph the odometer to start recording a trip.',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary btn--xl btn--block',
        onclick: async (event) => {
          await withBusy(event.currentTarget, 'Opening camera…', async () => {
            const done = await startTripFlow();
            if (done) await refresh();
          });
        },
      },
      'Start trip',
    ),
  );
}

function renderPeriodCard({ openPeriod, periods, trips, refresh }) {
  const closed = periods.filter((p) => p.end);

  if (openPeriod) {
    const summary = summarisePeriod(openPeriod, trips);
    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Logbook period running'),
      h(
        'dl',
        { class: 'readout' },
        readoutRow('Started', formatDateTime(openPeriod.start.at)),
        readoutRow(
          'Days elapsed',
          `${summary.days} ${summary.days === 1 ? 'day' : 'days'}`,
        ),
        readoutRow('Business km so far', `${formatKm(summary.businessKm)} km`),
        readoutRow('Logged km so far', `${formatKm(summary.loggedKm)} km`),
        readoutRow(
          'Business use so far',
          summary.businessPercent === null
            ? '—'
            : formatPercent(summary.businessPercent),
        ),
      ),
      summary.meetsTwelveWeeks
        ? h(
            'p',
            { class: 'note note--ok' },
            'This period has run the 12 continuous weeks the ATO asks for.',
          )
        : h(
            'p',
            { class: 'note' },
            `${Math.max(0, 84 - summary.days)} more days to reach 12 continuous weeks.`,
          ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--secondary btn--block',
          onclick: async (event) => {
            await withBusy(event.currentTarget, 'Opening camera…', async () => {
              const done = await endPeriodFlow(openPeriod);
              if (done) await refresh();
            });
          },
        },
        'End logbook period',
      ),
    );
  }

  const latest = closed[0];
  const latestSummary = latest ? summarisePeriod(latest, trips) : null;

  return h(
    'section',
    { class: 'card card--quiet' },
    h('h2', { class: 'card__title' }, 'Logbook period'),
    latestSummary
      ? h(
          'dl',
          { class: 'readout' },
          readoutRow(
            'Last period',
            `${latestSummary.days} days to ${formatRelative(latest.end.at)}`,
          ),
          readoutRow('Total km', `${formatKm(latestSummary.totalKm)} km`),
          readoutRow('Business km', `${formatKm(latestSummary.businessKm)} km`),
          readoutRow(
            'Business use',
            latestSummary.businessPercent === null
              ? '—'
              : formatPercent(latestSummary.businessPercent),
          ),
        )
      : h(
          'p',
          { class: 'card__text' },
          'Optional. Run a 12 week period to work out your business use percentage.',
        ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--secondary btn--block',
        onclick: async (event) => {
          await withBusy(event.currentTarget, 'Opening camera…', async () => {
            const done = await startPeriodFlow();
            if (done) await refresh();
          });
        },
      },
      'Start logbook period',
    ),
  );
}

function renderBackupBanner({ refresh }) {
  const driveReady = isDriveConfigured();

  const action = driveReady
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          onclick: async (event) => {
            await withBusy(event.currentTarget, 'Backing up…', async () => {
              try {
                const file = await backupToDrive({ interactive: true });
                toast(
                  file.deleted
                    ? `Backed up. ${file.deleted} old backup${file.deleted === 1 ? '' : 's'} removed.`
                    : 'Backed up to Google Drive.',
                  { type: 'success' },
                );
                await refresh();
              } catch (err) {
                toast(err.message || 'Backup failed.', { type: 'error' });
              }
            });
          },
        },
        hasValidToken() ? 'Back up now' : 'Connect and back up',
      )
    : h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          onclick: async (event) => {
            await withBusy(event.currentTarget, 'Preparing…', async () => {
              try {
                const result = await shareBackup();
                if (result !== 'cancelled') {
                  toast(
                    result === 'shared' ? 'Backup shared.' : 'Backup downloaded.',
                    { type: 'success' },
                  );
                  await refresh();
                }
              } catch (err) {
                toast(err.message || 'Could not create the backup.', { type: 'error' });
              }
            });
          },
        },
        canShareFiles() ? 'Share backup' : 'Download backup',
      );

  return h(
    'div',
    { class: 'banner banner--warn', role: 'status' },
    h(
      'div',
      { class: 'banner__text' },
      h('strong', null, 'Backup needed'),
      h(
        'span',
        null,
        driveReady
          ? 'New trips are not backed up yet.'
          : 'Google Drive is not set up. Save a copy through the share sheet.',
      ),
    ),
    action,
  );
}

/* ------------------------------------------------------------- helpers -- */

function stat(label, value, hint, variant = '') {
  return h(
    'div',
    { class: `stat ${variant ? `stat--${variant}` : ''}` },
    h('span', { class: 'stat__label' }, label),
    h('span', { class: 'stat__value' }, value),
    hint ? h('span', { class: 'stat__hint' }, hint) : null,
  );
}

function readoutRow(label, value) {
  return h(
    'div',
    { class: 'readout__row' },
    h('dt', { class: 'readout__label' }, label),
    h('dd', { class: 'readout__value' }, value),
  );
}
