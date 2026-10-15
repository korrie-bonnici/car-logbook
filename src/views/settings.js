/**
 * Settings: Google Drive backup and restore, CSV export, storage and data.
 */
import {
  getGoogleClientId,
  isClientIdOverridden,
  isDriveConfigured,
  looksLikeClientId,
  setGoogleClientIdOverride,
  BACKUPS_TO_KEEP,
  BACKUP_FOLDER_NAME,
} from '../lib/config.js';
import {
  backupToDrive,
  connectionStatus,
  disconnect,
  downloadBackup,
  getAccessToken,
  listBackups,
} from '../lib/drive.js';
import {
  describeBackup,
  parseBackupFile,
  restoreBackup,
  META_LAST_BACKUP_AT,
  META_LAST_BACKUP_TARGET,
} from '../lib/backup.js';
import { canShareFiles, exportCsv, shareBackup } from '../lib/export.js';
import {
  estimateStorage,
  getMeta,
  pruneOrphanPhotos,
  requestPersistentStorage,
  wipeEverything,
} from '../lib/db.js';
import {
  currentFinancialYear,
  financialYearLabel,
  formatDateTime,
  formatRelative,
} from '../lib/dates.js';
import {
  financialYearsWithTrips,
  formatKm,
  loadState,
  summarise,
} from '../lib/logbook.js';
import { formatBytes } from '../lib/photo.js';
import { h, clear, confirmDialog, openModal, spinner, toast, withBusy } from '../lib/ui.js';

export async function renderSettings({ refresh }) {
  const [{ trips, periods }, lastBackupAt, lastTarget, storage] = await Promise.all([
    loadState(),
    getMeta(META_LAST_BACKUP_AT),
    getMeta(META_LAST_BACKUP_TARGET),
    estimateStorage(),
  ]);

  const totals = summarise(trips);
  const view = h('div', { class: 'view view--settings' });

  view.appendChild(
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Settings'),
      h('p', { class: 'page-sub' }, 'Backup, export and stored data'),
    ),
  );

  view.appendChild(renderDriveSection({ lastBackupAt, lastTarget, refresh }));
  view.appendChild(renderShareSection({ refresh }));
  view.appendChild(renderExportSection({ trips }));
  view.appendChild(renderDataSection({ totals, periods, storage, refresh }));
  view.appendChild(renderAboutSection());

  return view;
}

/* ---------------------------------------------------------------- Drive -- */

function renderDriveSection({ lastBackupAt, lastTarget, refresh }) {
  const configured = isDriveConfigured();
  const status = connectionStatus();

  const section = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'Google Drive backup'),
  );

  if (!configured) {
    section.appendChild(
      h(
        'p',
        { class: 'card__text' },
        'Not set up. Add a Google OAuth Client ID to back up automatically ' +
          'after every trip. Until then, use the share sheet backup below.',
      ),
    );
    section.appendChild(
      h(
        'p',
        { class: 'card__text card__text--muted' },
        'The README has the step-by-step Google Cloud walkthrough.',
      ),
    );
    section.appendChild(renderClientIdForm(refresh));
    return section;
  }

  section.appendChild(
    h(
      'dl',
      { class: 'readout' },
      row('Status', status.state === 'connected' ? 'Connected' : 'Not connected'),
      row('Folder', BACKUP_FOLDER_NAME),
      row('Keeps', `${BACKUPS_TO_KEEP} most recent backups`),
      row(
        'Last backed up',
        lastBackupAt
          ? `${formatRelative(lastBackupAt)}${lastTarget === 'drive' ? '' : ' (shared file)'}`
          : 'Never',
      ),
    ),
  );

  const actions = h('div', { class: 'stack' });

  actions.appendChild(
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary btn--block',
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
      status.state === 'connected' ? 'Back up now' : 'Connect and back up',
    ),
  );

  actions.appendChild(
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--secondary btn--block',
        onclick: () => openRestoreSheet(refresh),
      },
      'Restore from Drive',
    ),
  );

  if (status.state === 'connected') {
    actions.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost btn--block',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Disconnect Google Drive?',
              body:
                'Automatic backups will stop until you connect again. ' +
                'Backups already in Drive are left alone.',
              confirmLabel: 'Disconnect',
            });
            if (!ok) return;
            await disconnect();
            toast('Disconnected from Google Drive.');
            await refresh();
          },
        },
        'Disconnect',
      ),
    );
  }

  section.appendChild(actions);
  section.appendChild(renderClientIdForm(refresh));
  return section;
}

function renderClientIdForm(refresh) {
  const current = getGoogleClientId();
  const overridden = isClientIdOverridden();

  const details = h('details', { class: 'disclosure' });
  details.appendChild(
    h('summary', { class: 'disclosure__summary' }, 'OAuth Client ID'),
  );

  const input = h('input', {
    class: 'field__input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: '1234-abcd.apps.googleusercontent.com',
    value: current,
  });

  const messages = h('div', { class: 'modal__messages' });

  details.appendChild(
    h(
      'div',
      { class: 'disclosure__body' },
      h(
        'p',
        { class: 'card__text card__text--muted' },
        overridden
          ? 'Set on this device. It overrides the value in app-config.js.'
          : 'Read from app-config.js. Saving here overrides it on this device only.',
      ),
      h('div', { class: 'field' }, input),
      messages,
      h(
        'div',
        { class: 'stack stack--row' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary',
            onclick: async () => {
              clear(messages);
              const value = input.value.trim();
              if (value && !looksLikeClientId(value)) {
                messages.appendChild(
                  h(
                    'p',
                    { class: 'message message--error' },
                    'That does not look like a Client ID. It should end in .apps.googleusercontent.com',
                  ),
                );
                return;
              }
              setGoogleClientIdOverride(value);
              toast(value ? 'Client ID saved on this device.' : 'Device Client ID cleared.');
              await refresh();
            },
          },
          'Save',
        ),
        overridden
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost',
                onclick: async () => {
                  setGoogleClientIdOverride('');
                  toast('Device Client ID cleared.');
                  await refresh();
                },
              },
              'Clear',
            )
          : null,
      ),
    ),
  );

  return details;
}

/* -------------------------------------------------------------- restore -- */

function openRestoreSheet(refresh) {
  return openModal((close) => {
    const body = h('div', { class: 'modal__body' }, spinner('Loading backups'));

    const panel = [
      h('h2', { class: 'modal__title', id: 'modal-title' }, 'Restore from Drive'),
      body,
      h(
        'div',
        { class: 'modal__actions' },
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost', onclick: () => close(false) },
          'Close',
        ),
      ),
    ];

    (async () => {
      try {
        const token = await getAccessToken({ interactive: true });
        if (!token) throw new Error('Not connected to Google Drive.');
        const files = await listBackups({ interactive: false });
        clear(body);

        if (files.length === 0) {
          body.appendChild(
            h(
              'p',
              { class: 'card__text' },
              `No backups found in "${BACKUP_FOLDER_NAME}" yet.`,
            ),
          );
          return;
        }

        body.appendChild(
          h(
            'p',
            { class: 'card__text card__text--muted' },
            'Restoring replaces everything on this device with the chosen backup.',
          ),
        );

        const list = h('ul', { class: 'backup-list' });
        for (const file of files) {
          list.appendChild(
            h(
              'li',
              { class: 'backup-list__item' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'backup',
                  onclick: () => pickBackup(file, close, refresh),
                },
                h('span', { class: 'backup__date' }, formatDateTime(file.createdTime)),
                h(
                  'span',
                  { class: 'backup__meta' },
                  `${file.name}${file.size ? ` · ${formatBytes(Number(file.size))}` : ''}`,
                ),
              ),
            ),
          );
        }
        body.appendChild(list);
      } catch (err) {
        clear(body);
        body.appendChild(
          h('p', { class: 'message message--error' }, err.message || 'Could not list backups.'),
        );
      }
    })();

    return panel;
  });
}

async function pickBackup(file, closeList, refresh) {
  let payload;
  try {
    payload = await downloadBackup(file.id);
  } catch (err) {
    toast(err.message || 'Could not download that backup.', { type: 'error' });
    return;
  }

  const info = describeBackup(payload);
  const ok = await confirmDialog({
    title: 'Restore this backup?',
    body:
      `${file.name} holds ${info.trips} trip${info.trips === 1 ? '' : 's'}, ` +
      `${info.periods} logbook period${info.periods === 1 ? '' : 's'} and ` +
      `${info.photos} photo${info.photos === 1 ? '' : 's'}. ` +
      'Everything currently on this device will be replaced. This cannot be undone.',
    confirmLabel: 'Replace my data',
    destructive: true,
  });
  if (!ok) return;

  try {
    await restoreBackup(payload);
    closeList(true);
    toast(`Restored ${info.trips} trips.`, { type: 'success' });
    await refresh();
  } catch (err) {
    toast(err.message || 'Restore failed.', { type: 'error' });
  }
}

/* ---------------------------------------------------------------- share -- */

function renderShareSection({ refresh }) {
  const shareable = canShareFiles();

  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'Backup file'),
    h(
      'p',
      { class: 'card__text' },
      shareable
        ? 'Save one JSON file holding every trip and photo. The Android share ' +
            'sheet lets you drop it into Drive, Keep or anywhere else.'
        : 'Download one JSON file holding every trip and photo.',
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
                const result = await shareBackup();
                if (result !== 'cancelled') {
                  toast(result === 'shared' ? 'Backup shared.' : 'Backup downloaded.', {
                    type: 'success',
                  });
                  await refresh();
                }
              } catch (err) {
                toast(err.message || 'Could not create the backup.', { type: 'error' });
              }
            });
          },
        },
        shareable ? 'Share backup' : 'Download backup',
      ),
      renderFileRestore(refresh),
    ),
  );
}

function renderFileRestore(refresh) {
  const input = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      let payload;
      try {
        payload = await parseBackupFile(file);
      } catch (err) {
        toast(err.message || 'That file could not be read.', { type: 'error' });
        return;
      }

      const info = describeBackup(payload);
      const ok = await confirmDialog({
        title: 'Restore this file?',
        body:
          `It holds ${info.trips} trip${info.trips === 1 ? '' : 's'} and ` +
          `${info.photos} photo${info.photos === 1 ? '' : 's'}. ` +
          'Everything currently on this device will be replaced. This cannot be undone.',
        confirmLabel: 'Replace my data',
        destructive: true,
      });
      if (!ok) return;

      try {
        await restoreBackup(payload);
        toast(`Restored ${info.trips} trips.`, { type: 'success' });
        await refresh();
      } catch (err) {
        toast(err.message || 'Restore failed.', { type: 'error' });
      }
    },
  });

  return h(
    'div',
    null,
    input,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--block',
        onclick: () => input.click(),
      },
      'Restore from a backup file',
    ),
  );
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
      'One CSV per financial year, with a business use summary at the bottom.',
    ),
  );

  if (years.length === 0) {
    section.appendChild(
      h('p', { class: 'card__text card__text--muted' }, 'No completed trips to export yet.'),
    );
    return section;
  }

  const stack = h('div', { class: 'stack' });
  for (const year of years) {
    stack.appendChild(
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
                  toast(
                    result === 'shared' ? 'CSV shared.' : 'CSV downloaded.',
                    { type: 'success' },
                  );
                }
              } catch (err) {
                toast(err.message || 'Export failed.', { type: 'error' });
              }
            });
          },
        },
        `FY ${financialYearLabel(year)}${year === currentFinancialYear() ? ' (current)' : ''}`,
      ),
    );
  }
  section.appendChild(stack);
  return section;
}

/* ----------------------------------------------------------------- data -- */

function renderDataSection({ totals, periods, storage, refresh }) {
  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'Stored data'),
    h(
      'dl',
      { class: 'readout' },
      row('Trips', formatKm(totals.tripCount)),
      row('Logbook periods', formatKm(periods.length)),
      row('All-time distance', `${formatKm(totals.allTimeKm)} km`),
      row(
        'Storage used',
        storage?.usage ? formatBytes(storage.usage) : 'Unknown',
      ),
    ),
    h(
      'div',
      { class: 'stack' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost btn--block',
          onclick: async (event) => {
            await withBusy(event.currentTarget, 'Checking…', async () => {
              const persisted = await requestPersistentStorage();
              const removed = await pruneOrphanPhotos();
              toast(
                `${persisted ? 'Storage is persistent. ' : ''}` +
                  `${removed} stray photo${removed === 1 ? '' : 's'} cleared.`,
              );
              await refresh();
            });
          },
        },
        'Tidy up storage',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--danger-quiet btn--block',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Erase everything?',
              body:
                'Every trip, logbook period and photo on this device will be deleted. ' +
                'Backups already in Drive are not touched. This cannot be undone.',
              confirmLabel: 'Erase all data',
              destructive: true,
            });
            if (!ok) return;

            const reallyOk = await confirmDialog({
              title: 'Are you certain?',
              body: 'There is no undo. Make a backup first if you are unsure.',
              confirmLabel: 'Yes, erase it',
              destructive: true,
            });
            if (!reallyOk) return;

            await wipeEverything();
            toast('All data erased.');
            await refresh();
          },
        },
        'Erase all data',
      ),
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
      'Car Logbook stores everything on this device and works offline. ' +
        'Photos never leave the phone unless you back them up yourself. ' +
        'Figures here are a record-keeping aid, not tax advice.',
    ),
  );
}

/* -------------------------------------------------------------- helpers -- */

function row(label, value) {
  return h(
    'div',
    { class: 'readout__row' },
    h('dt', { class: 'readout__label' }, label),
    h('dd', { class: 'readout__value' }, value),
  );
}
