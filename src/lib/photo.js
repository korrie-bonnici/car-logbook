/**
 * Odometer photo capture and compression.
 *
 * Capture uses a plain file input with `capture="environment"`, which on
 * Android opens the rear camera straight into the system camera app. That is
 * far more reliable than getUserMedia: it needs no permission prompt of our
 * own, gets the phone's real camera processing, and cannot leave a live
 * stream running if the page is backgrounded mid-capture.
 *
 * Every photo is downscaled and re-encoded to sit under TARGET_BYTES so a few
 * hundred trips still fit comfortably in IndexedDB and in a Drive backup.
 */
import { newId } from './db.js';

export const TARGET_BYTES = 200 * 1024; // ~200 KB per the spec
const MAX_EDGE = 1280; // plenty for reading odometer digits
const MIN_EDGE = 640; // never shrink below this; OCR needs the detail
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.42, 0.34];

/**
 * Opens the rear camera and resolves with the chosen File, or null if the
 * user backed out.
 */
export function captureOdometerPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onFocus);
      resolve(value);
    };

    input.addEventListener('change', () => {
      finish(input.files && input.files[0] ? input.files[0] : null);
    });

    // Android fires no event when the camera app is cancelled. Refocusing the
    // page is the only signal we get, so poll once after it returns.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(null);
      }, 800);
    };
    window.addEventListener('focus', onFocus);

    input.click();
  });
}

/** Reads a File/Blob into an ImageBitmap, honouring EXIF orientation. */
async function decode(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      /* Safari/older Android: fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = url;
    });
    return img;
  } finally {
    // The bitmap is drawn synchronously by the caller, so revoking on the next
    // task is safe and avoids leaking the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function drawToCanvas(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * Downscales and compresses until the JPEG fits under TARGET_BYTES.
 * Returns a photo record ready for IndexedDB.
 */
export async function compressPhoto(file) {
  const source = await decode(file);
  const srcW = source.width;
  const srcH = source.height;

  let scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  let blob = null;
  let width = Math.round(srcW * scale);
  let height = Math.round(srcH * scale);

  // Two nested knobs: quality first (cheap, keeps resolution), then size.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    width = Math.max(1, Math.round(srcW * scale));
    height = Math.max(1, Math.round(srcH * scale));
    const canvas = drawToCanvas(source, width, height);

    for (const quality of QUALITY_STEPS) {
      // eslint-disable-next-line no-await-in-loop
      const candidate = await canvasToBlob(canvas, quality);
      if (!candidate) break;
      blob = candidate;
      if (candidate.size <= TARGET_BYTES) break;
    }

    if (blob && blob.size <= TARGET_BYTES) break;
    if (Math.max(width, height) <= MIN_EDGE) break;
    scale *= 0.8;
  }

  if (typeof source.close === 'function') source.close();

  if (!blob) throw new Error('Could not compress that photo.');

  return {
    id: newId(),
    blob,
    type: 'image/jpeg',
    width,
    height,
    bytes: blob.size,
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------- object URL pool -- */

const urlCache = new Map();

/** Stable object URL for a photo record, reused across re-renders. */
export function photoUrl(photo) {
  if (!photo || !photo.blob) return null;
  if (urlCache.has(photo.id)) return urlCache.get(photo.id);
  const url = URL.createObjectURL(photo.blob);
  urlCache.set(photo.id, url);
  return url;
}

export function releasePhotoUrl(photoId) {
  const url = urlCache.get(photoId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(photoId);
  }
}

export function releaseAllPhotoUrls() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

/* -------------------------------------------------------- base64 bridge -- */

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      // Strip the "data:image/jpeg;base64," prefix.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read photo.'));
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64, type = 'image/jpeg') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
