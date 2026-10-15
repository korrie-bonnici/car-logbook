/**
 * Settings: the accountant's CSV, backup files and erasing everything.
 */
import { applyRestore, getLastBackupAt, parseBackup } from '../lib/backup.js';
import { canShareFiles, exportCsv, saveBackup } from '../lib/export.js';
import { wipeEverything } from '../lib/db.js';
import { loadState } from '../lib/logbook.js';
import { currentFinancialYear, financialYearLabel, formatRelative } from '../lib/dates.js';
import { financialYearsWithTrips, formatKm, isComplete } from '../lib/trip.js';
import { h, confirmDialog, toast, withBusy } from '../lib/ui.js';

export async function renderSettings({ refresh }) {
  const [{ trips }, lastBackupAt] = await Promise.all([loadState(), getLastBackupAt()]);

  const view = h('div', { class: 'view view--settings' });

  view.appendChild(
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Settings'),
      h('p', { class: 'page-sub' }, 'Export, backup and stored data'),
    ),
  );

  view.appendChild(renderExportSection({ trips }));
  view.appendChild(renderBackupSection({ lastBackupAt, refresh }));
  view.appendChild(renderDataSection({ trips, refresh }));
  view.appendChild(renderAboutSection());

  return view;
}

/* --------------------------------------------------------------- export -- */

function renderExportSection({ trips }) {
  const years = financialYearsWithTrips(trips);
  const section = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'Export for your accountant'),
    h(
      'p',
      { class: 'card__text' },
      'One spreadsheet (CSV) per financial year: every trip with its date, ' +
        'readings, distance and purpose, and the total at the bottom.',
    ),
  );

  if (years.length === 0) {
    section.appendChild(
      h('p', { class: 'card__text card__text--muted' }, 'No finished trips to export yet.'),
    );
    return section;
  }

  section.appendChild(
    h(
      'div',
      { class: 'stack' },
      ...years.map((year) =>
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary btn--block',
            onclick: async (event) => {
              await withBusy(event.currentTarget, 'Preparing…', async () => {
                try {
                  const result = await exportCsv(trips, year);
                  if (result !== 'cancelled') {
                    toast(result === 'shared' ? 'CSV shared.' : 'CSV downloaded.', {
                      type: 'success',
                    });
                  }
                } catch (err) {
                  toast(err.message || 'Export failed.', { type: 'error' });
                }
              });
            },
          },
          `FY ${financialYearLabel(year)}${year === currentFinancialYear() ? ' (current)' : ''}`,
        ),
      ),
    ),
  );
  return section;
}

/* --------------------------------------------------------------- backup -- */

function renderBackupSection({ lastBackupAt, refresh }) {
  const shareable = canShareFiles();

  const input = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await restoreFromFile(file, refresh);
    },
  });

  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'Backup'),
    h(
      'p',
      { class: 'card__text' },
      shareable
        ? 'Your trips live only on this phone. Save a backup file and put it ' +
            'somewhere safe, such as Google Drive or an email to yourself.'
        : 'Your trips live only on this device. Download a backup file and keep it somewhere safe.',
    ),
    h(
      'p',
      { class: 'card__text card__text--muted' },
      lastBackupAt ? `Last backup: ${formatRelative(lastBackupAt)}` : 'No backup saved yet.',
    ),
    h(
      'div',
      { class: 'stack' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--secondary btn--block',
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
        shareable ? 'Save backup' : 'Download backup',
      ),
      input,
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--block', onclick: () => input.click() },
        'Restore from a backup file',
      ),
    ),
  );
}

async function restoreFromFile(file, refresh) {
  let backup;
  try {
    backup = parseBackup(await file.text());
  } catch (err) {
    toast(err.message || 'That file could not be read.', { type: 'error' });
    return;
  }

  const count = backup.trips.length;
  const ok = await confirmDialog({
    title: 'Restore this backup?',
    body:
      `It holds ${count} trip${count === 1 ? '' : 's'}. ` +
      'Everything currently on this phone will be replaced. This cannot be undone.',
    confirmLabel: 'Replace my trips',
    destructive: true,
  });
  if (!ok) return;

  try {
    await applyRestore(backup);
    toast(`Restored ${count} trip${count === 1 ? '' : 's'}.`, { type: 'success' });
    await refresh();
  } catch (err) {
    toast(err.message || 'Restore failed.', { type: 'error' });
  }
}

/* ----------------------------------------------------------------- data -- */

function renderDataSection({ trips, refresh }) {
  const finished = trips.filter(isComplete).length;

  return h(
    'section',
    { class: 'card card--quiet' },
    h('h2', { class: 'card__title' }, 'Stored data'),
    h('p', { class: 'card__text' }, `${formatKm(finished)} trip${finished === 1 ? '' : 's'} on this phone.`),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--danger-quiet btn--block',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Erase everything?',
            body:
              'Every trip on this phone will be deleted. Backup files you have ' +
              'saved elsewhere are not touched. This cannot be undone.',
            confirmLabel: 'Erase all trips',
            destructive: true,
          });
          if (!ok) return;

          const reallyOk = await confirmDialog({
            title: 'Are you certain?',
            body: 'There is no undo. Save a backup first if you are unsure.',
            confirmLabel: 'Yes, erase them',
            destructive: true,
          });
          if (!reallyOk) return;

          await wipeEverything();
          toast('All trips erased.');
          await refresh();
        },
      },
      'Erase all trips',
    ),
  );
}

function renderAboutSection() {
  return h(
    'section',
    { class: 'card card--quiet' },
    h('h2', { class: 'card__title' }, 'About'),
    h(
      'p',
      { class: 'card__text card__text--muted' },
      'Car Logbook keeps your trips on this phone and works offline. Odometer ' +
        'photos are read for their digits and then discarded. The digit reader ' +
        'downloads once, the first time you use it, so do that with a connection. ' +
        'This is a record-keeping aid, not tax advice.',
    ),
  );
}
