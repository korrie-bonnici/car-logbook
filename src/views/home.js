/**
 * Home: the trip in progress (or the button to start one), this financial
 * year's totals, and a nudge when a backup is due.
 */
import {
  currentFinancialYear,
  financialYearLabel,
  formatDateTime,
  formatRelative,
} from '../lib/dates.js';
import { cancelTrip, loadState } from '../lib/logbook.js';
import { formatKm, summarise } from '../lib/trip.js';
import { backupReminder, getLastBackupAt } from '../lib/backup.js';
import { canShareFiles, saveBackup } from '../lib/export.js';
import { endTripFlow, startTripFlow } from '../lib/actions.js';
import { h, toast, withBusy, confirmDialog } from '../lib/ui.js';

export async function renderHome({ navigate, refresh }) {
  const [{ trips, openTrip }, lastBackupAt] = await Promise.all([
    loadState(),
    getLastBackupAt(),
  ]);

  const year = currentFinancialYear();
  const totals = summarise(trips, year);
  const reminder = backupReminder({ trips, lastBackupAt });

  const view = h('div', { class: 'view view--home' });

  view.appendChild(
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Car Logbook'),
      h('p', { class: 'page-sub' }, `Financial year ${financialYearLabel(year)}`),
    ),
  );

  view.appendChild(renderTripCard({ openTrip, refresh }));

  view.appendChild(
    h(
      'section',
      { class: 'stats', 'aria-label': 'This financial year' },
      stat('Business km', formatKm(totals.km), `FY ${financialYearLabel(year)}`, 'primary'),
      stat('Trips', formatKm(totals.tripCount), 'This financial year'),
    ),
  );

  if (reminder.show) view.appendChild(renderBackupBanner({ reminder, lastBackupAt, refresh }));

  view.appendChild(
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--secondary btn--block',
        onclick: () => navigate('trips'),
      },
      'View all trips',
    ),
  );

  view.appendChild(
    h(
      'p',
      { class: 'page-foot' },
      lastBackupAt ? `Last backup ${formatRelative(lastBackupAt).toLowerCase()}` : 'No backup yet',
    ),
  );

  return view;
}

/* ------------------------------------------------------------ sections -- */

function renderTripCard({ openTrip, refresh }) {
  if (openTrip) {
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
        readoutRow('Started', formatDateTime(openTrip.start.at)),
        readoutRow('Start reading', `${formatKm(openTrip.start.odometer)} km`),
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
                if (await endTripFlow(openTrip)) await refresh();
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
                body: 'The start reading will be deleted. This cannot be undone.',
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
    h('p', { class: 'card__text' }, 'Photograph the odometer as you set off on a business trip.'),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary btn--xl btn--block',
        onclick: async (event) => {
          await withBusy(event.currentTarget, 'Opening camera…', async () => {
            if (await startTripFlow()) await refresh();
          });
        },
      },
      'Start trip',
    ),
  );
}

function renderBackupBanner({ reminder, lastBackupAt, refresh }) {
  const trips = `${reminder.unsaved} trip${reminder.unsaved === 1 ? '' : 's'}`;
  return h(
    'div',
    { class: 'banner banner--warn', role: 'status' },
    h(
      'div',
      { class: 'banner__text' },
      h('strong', null, 'Time for a backup'),
      h(
        'span',
        null,
        lastBackupAt
          ? `${trips} added or changed since your last backup.`
          : `${trips} only on this phone so far.`,
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        onclick: async (event) => {
          await withBusy(event.currentTarget, 'Preparing…', async () => {
            try {
              const result = await saveBackup();
              if (result === 'cancelled') return;
              toast(result === 'shared' ? 'Backup saved.' : 'Backup downloaded.', {
                type: 'success',
              });
              await refresh();
            } catch (err) {
              toast(err.message || 'Could not create the backup.', { type: 'error' });
            }
          });
        },
      },
      canShareFiles() ? 'Save backup' : 'Download backup',
    ),
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
