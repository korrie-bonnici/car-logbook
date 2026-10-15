/**
 * Configuration resolution.
 *
 * Priority: device override (Settings screen) > public/app-config.js > empty.
 * An empty client ID means "Drive is not set up" and the UI hides Drive controls.
 */

const OVERRIDE_KEY = 'carlogbook.googleClientId';

const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9-_]+\.apps\.googleusercontent\.com$/i;

function fromFile() {
  const cfg = globalThis.CAR_LOGBOOK_CONFIG;
  if (!cfg || typeof cfg.googleClientId !== 'string') return '';
  return cfg.googleClientId.trim();
}

function fromDevice() {
  try {
    return (localStorage.getItem(OVERRIDE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function getGoogleClientId() {
  return fromDevice() || fromFile();
}

export function setGoogleClientIdOverride(value) {
  const trimmed = (value || '').trim();
  try {
    if (trimmed) localStorage.setItem(OVERRIDE_KEY, trimmed);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* private mode — ignore */
  }
}

export function isClientIdOverridden() {
  return Boolean(fromDevice());
}

/** Shape check only. The real test is whether Google accepts it. */
export function looksLikeClientId(value) {
  return CLIENT_ID_PATTERN.test((value || '').trim());
}

/** True when Drive backup/restore controls should be shown at all. */
export function isDriveConfigured() {
  return Boolean(getGoogleClientId());
}

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const BACKUP_FOLDER_NAME = 'Car Logbook Backups';
export const BACKUPS_TO_KEEP = 10;
