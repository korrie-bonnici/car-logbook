/**
 * Google Drive backup through Google Identity Services.
 *
 * Scope is drive.file only, which means this app can see and touch just the
 * files it created itself. It cannot read anything else in your Drive, and
 * revoking access in your Google account removes it cleanly.
 *
 * There is no client secret and no server. GIS hands us a short-lived access
 * token in the browser; we cache it until it expires and then ask again.
 */
import {
  BACKUPS_TO_KEEP,
  BACKUP_FOLDER_NAME,
  DRIVE_SCOPE,
  getGoogleClientId,
  isDriveConfigured,
} from './config.js';
import { buildBackupBlob, markBackedUp, validateBackup } from './backup.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TOKEN_KEY = 'carlogbook.driveToken';
// Refresh a little early so a long upload cannot straddle the expiry.
const EXPIRY_SKEW_MS = 120_000;

let gisPromise = null;
let tokenClient = null;
let cachedToken = null;

/* ------------------------------------------------------------- GIS load -- */

function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) {
      resolve(globalThis.google);
      return;
    }
    const el = document.createElement('script');
    el.src = GIS_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => {
      if (globalThis.google?.accounts?.oauth2) resolve(globalThis.google);
      else reject(new Error('Google sign-in loaded but did not register.'));
    };
    el.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not reach Google. Check your connection.'));
    };
    document.head.appendChild(el);
  });
  return gisPromise;
}

/* ---------------------------------------------------------------- token -- */

function readStoredToken() {
  if (cachedToken) return cachedToken;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken || !parsed?.expiresAt) return null;
    cachedToken = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function storeToken(token) {
  cachedToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — token lives in memory only */
  }
}

/** True when we hold a token that has not expired. */
export function hasValidToken() {
  const token = readStoredToken();
  if (!token) return false;
  return token.expiresAt - EXPIRY_SKEW_MS > Date.now();
}

export function tokenExpiresAt() {
  return readStoredToken()?.expiresAt ?? null;
}

export function forgetToken() {
  storeToken(null);
}

/** Revokes the token with Google as well as dropping it locally. */
export async function disconnect() {
  const token = readStoredToken();
  storeToken(null);
  if (!token?.accessToken) return;
  try {
    const google = await loadGis();
    google.accounts.oauth2.revoke(token.accessToken);
  } catch {
    /* already unreachable or revoked; local state is what matters */
  }
}

async function getTokenClient() {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('No Google Client ID is configured.');

  const google = await loadGis();
  if (!tokenClient || tokenClient.__clientId !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: () => {}, // replaced per request below
    });
    tokenClient.__clientId = clientId;
  }
  return tokenClient;
}

/**
 * Returns a usable access token.
 *
 * `interactive: false` resolves null rather than opening a popup, which is
 * what auto-backup uses so it can never interrupt you.
 */
export async function getAccessToken({ interactive = true } = {}) {
  if (hasValidToken()) return readStoredToken().accessToken;
  if (!interactive) return null;

  const client = await getTokenClient();

  return new Promise((resolve, reject) => {
    client.callback = (response) => {
      if (response?.error) {
        reject(new Error(describeAuthError(response)));
        return;
      }
      const expiresIn = Number(response.expires_in || 3600) * 1000;
      storeToken({
        accessToken: response.access_token,
        expiresAt: Date.now() + expiresIn,
        scope: response.scope || DRIVE_SCOPE,
      });
      resolve(response.access_token);
    };
    client.error_callback = (err) => {
      reject(new Error(describeAuthError(err)));
    };

    try {
      // 'consent' only on the very first grant; after that Google reuses it.
      client.requestAccessToken({ prompt: readStoredToken() ? '' : 'consent' });
    } catch (err) {
      reject(err);
    }
  });
}

function describeAuthError(response) {
  const type = response?.type || response?.error;
  if (type === 'popup_closed' || type === 'popup_closed_by_user') {
    return 'Sign-in window was closed before finishing.';
  }
  if (type === 'popup_failed_to_open') {
    return 'Your browser blocked the Google sign-in popup. Allow popups and try again.';
  }
  if (type === 'access_denied') return 'Access to Google Drive was declined.';
  return response?.error_description || 'Google sign-in failed.';
}

/* ------------------------------------------------------------ transport -- */

async function driveFetch(url, { token, ...init } = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    // Token went stale or was revoked from the Google account page.
    forgetToken();
    const body = await safeJson(response);
    throw new Error(
      body?.error?.message
        ? `Google Drive refused the request: ${body.error.message}`
        : 'Google Drive access expired. Connect again.',
    );
  }

  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(
      body?.error?.message || `Google Drive error (${response.status}).`,
    );
  }

  return response;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- folder -- */

async function findOrCreateFolder(token) {
  const query = [
    `name='${BACKUP_FOLDER_NAME.replace(/'/g, "\\'")}'`,
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
  ].join(' and ');

  const listUrl = `${DRIVE_FILES}?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10`;
  const listResponse = await driveFetch(listUrl, { token });
  const list = await listResponse.json();

  if (list.files?.length) return list.files[0].id;

  const createResponse = await driveFetch(`${DRIVE_FILES}?fields=id`, {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  const created = await createResponse.json();
  return created.id;
}

/* --------------------------------------------------------------- upload -- */

/**
 * Uploads a backup and prunes old ones.
 * Returns { id, name, createdTime, deleted }.
 */
export async function backupToDrive({ interactive = true } = {}) {
  if (!isDriveConfigured()) throw new Error('Google Drive is not set up yet.');

  const token = await getAccessToken({ interactive });
  if (!token) throw new Error('Not connected to Google Drive.');

  const folderId = await findOrCreateFolder(token);
  const { blob, filename } = await buildBackupBlob();

  const metadata = {
    name: filename,
    parents: [folderId],
    mimeType: 'application/json',
    description: 'Car Logbook backup. Trips, logbook periods and odometer photos.',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  );
  form.append('file', blob);

  const response = await driveFetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,createdTime,size`,
    { token, method: 'POST', body: form },
  );
  const file = await response.json();

  const deleted = await pruneOldBackups(token, folderId);
  await markBackedUp('drive');

  return { ...file, deleted };
}

/* ----------------------------------------------------------------- list -- */

export async function listBackups({ interactive = true } = {}) {
  if (!isDriveConfigured()) throw new Error('Google Drive is not set up yet.');

  const token = await getAccessToken({ interactive });
  if (!token) throw new Error('Not connected to Google Drive.');

  const folderId = await findOrCreateFolder(token);
  return listFolder(token, folderId);
}

async function listFolder(token, folderId) {
  const query = `'${folderId}' in parents and trashed=false and mimeType='application/json'`;
  const url =
    `${DRIVE_FILES}?q=${encodeURIComponent(query)}` +
    '&orderBy=createdTime desc&pageSize=50&fields=files(id,name,size,createdTime)';
  const response = await driveFetch(url, { token });
  const body = await response.json();
  return body.files || [];
}

async function pruneOldBackups(token, folderId) {
  const files = await listFolder(token, folderId);
  const stale = files.slice(BACKUPS_TO_KEEP);
  for (const file of stale) {
    // Sequential: a handful at most, and Drive rate-limits parallel deletes.
    // eslint-disable-next-line no-await-in-loop
    await driveFetch(`${DRIVE_FILES}/${file.id}`, { token, method: 'DELETE' }).catch(
      (err) => console.warn('[drive] could not delete old backup', err),
    );
  }
  return stale.length;
}

/* -------------------------------------------------------------- restore -- */

export async function downloadBackup(fileId) {
  const token = await getAccessToken({ interactive: true });
  if (!token) throw new Error('Not connected to Google Drive.');

  const response = await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`, { token });
  const payload = await response.json();
  validateBackup(payload);
  return payload;
}

/** Human-readable connection state for the Settings screen. */
export function connectionStatus() {
  if (!isDriveConfigured()) return { state: 'unconfigured' };
  if (hasValidToken()) return { state: 'connected', expiresAt: tokenExpiresAt() };
  return { state: 'disconnected' };
}
