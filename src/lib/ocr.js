/**
 * Odometer OCR via Tesseract.js, digits only.
 *
 * The engine (worker + wasm core + English traineddata, roughly 5 MB) is
 * pulled from jsDelivr the first time you run OCR, then served from the
 * service worker cache, so later runs work offline. Tesseract also keeps its
 * own copy of the traineddata in IndexedDB.
 *
 * OCR is strictly advisory. Everything it returns lands in an editable field
 * next to the photo, and a failure here never blocks saving a trip.
 */

const TESSERACT_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const LANG_DATA_VERSION = '1.0.0';

const SCRIPT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const WORKER_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const CORE_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VERSION}`;
const LANG_PATH = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@${LANG_DATA_VERSION}/4.0.0_best_int`;

// Tesseract page segmentation: 6 = one uniform block, 7 = one text line.
// Odometers read better as a single line, but a block catches a stacked
// trip-meter display, so we try both and keep whichever looks more plausible.
const PSM_SINGLE_BLOCK = '6';
const PSM_SINGLE_LINE = '7';

let scriptPromise = null;
let workerPromise = null;

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (globalThis.Tesseract) {
      resolve(globalThis.Tesseract);
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPT_URL;
    el.async = true;
    el.crossOrigin = 'anonymous';
    el.onload = () => {
      if (globalThis.Tesseract) resolve(globalThis.Tesseract);
      else reject(new Error('OCR engine loaded but did not register.'));
    };
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not download the OCR engine.'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

async function getWorker(onProgress) {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    const Tesseract = await loadScript();
    const worker = await Tesseract.createWorker(
      'eng',
      1,
      {
        workerPath: WORKER_URL,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        cacheMethod: 'write',
        logger: (m) => {
          if (onProgress && m && typeof m.progress === 'number') {
            onProgress(m.status, m.progress);
          }
        },
        errorHandler: (err) => console.warn('[ocr]', err),
      },
      {
        // Odometer digits are not words, so the dictionaries only add noise.
        // These are "init only" parameters: they must be passed here, as
        // setParameters cannot change them after the worker starts.
        load_system_dawg: '0',
        load_freq_dawg: '0',
        load_number_dawg: '0',
      },
    );
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: PSM_SINGLE_BLOCK,
    });
    return worker;
  })();

  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = null;
    throw err;
  }
}

/** True once the engine is in memory, so the UI can skip the "downloading" copy. */
export function isEngineReady() {
  return Boolean(workerPromise);
}

/**
 * Grayscale + contrast stretch at up to 2x scale. Odometer photos are usually
 * dim and low-contrast behind glass, and this lifts recognition noticeably.
 */
async function preprocess(blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(
    () => null,
  );
  if (!bitmap) return blob;

  const scale = Math.min(2, 1600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === 'function') bitmap.close();

  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;

  const grey = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, g = 0; i < px.length; i += 4, g += 1) {
    grey[g] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
  }

  const out = normaliseLuminance(grey);
  for (let i = 0, g = 0; i < px.length; i += 4, g += 1) {
    px[i] = out[g];
    px[i + 1] = out[g];
    px[i + 2] = out[g];
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result || blob), 'image/png');
  });
}

/**
 * Stretches greyscale values to the full 0-255 range, then inverts the image
 * when it is mostly dark. Tesseract reads dark text on a light background;
 * a digital dash shows light digits on a dark one, so those get flipped.
 */
export function normaliseLuminance(grey) {
  let min = 255;
  let max = 0;
  for (const value of grey) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const span = Math.max(1, max - min);
  const out = new Uint8ClampedArray(grey.length);
  let total = 0;
  for (let i = 0; i < grey.length; i += 1) {
    out[i] = ((grey[i] - min) * 255) / span;
    total += out[i];
  }

  if (grey.length && total / grey.length < 128) {
    for (let i = 0; i < out.length; i += 1) out[i] = 255 - out[i];
  }
  return out;
}

/**
 * Picks the most odometer-looking number out of raw OCR text.
 *
 * Odometers run 3 to 7 digits; anything outside that is noise. With `near`
 * (the last known reading) the best guess is the smallest number at or above
 * it, since the odometer only goes up. Otherwise, or when nothing qualifies,
 * the longest run wins, ties going to the larger value.
 */
export function pickReading(text, { near = null } = {}) {
  if (!text) return null;
  const runs = String(text).match(/\d+/g);
  if (!runs) return null;

  const candidates = runs
    .map((run) => run.replace(/^0+(?=\d)/, '')) // drop leading zeros
    .filter((run) => run.length >= 3 && run.length <= 7)
    .map((run) => Number.parseInt(run, 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (candidates.length === 0) return null;

  if (Number.isFinite(near)) {
    const above = candidates.filter((n) => n >= near).sort((a, b) => a - b);
    if (above.length) return above[0];
  }

  return candidates.sort((a, b) => {
    const lengthDiff = String(b).length - String(a).length;
    return lengthDiff !== 0 ? lengthDiff : b - a;
  })[0];
}

/**
 * Reads an odometer from a photo blob.
 *
 * Resolves with { reading, confidence, text } where reading may be null.
 * `near` is the last known reading, used to pick between candidate numbers.
 * Never throws for recognition failure; only for an engine that would not load.
 */
export async function readOdometer(blob, { onProgress, near = null } = {}) {
  const worker = await getWorker(onProgress);
  const prepared = await preprocess(blob);

  const attempts = [];

  const first = await worker.recognize(prepared);
  attempts.push({ psm: PSM_SINGLE_BLOCK, data: first.data });

  // If a single block gave us nothing usable, try treating it as one line.
  if (!pickReading(first.data?.text, { near })) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM_SINGLE_LINE });
    const second = await worker.recognize(prepared);
    attempts.push({ psm: PSM_SINGLE_LINE, data: second.data });
    await worker.setParameters({ tessedit_pageseg_mode: PSM_SINGLE_BLOCK });
  }

  let best = { reading: null, confidence: 0, text: '' };
  for (const attempt of attempts) {
    const reading = pickReading(attempt.data?.text, { near });
    const confidence = Number(attempt.data?.confidence) || 0;
    if (reading !== null && (best.reading === null || confidence > best.confidence)) {
      best = { reading, confidence, text: attempt.data?.text || '' };
    }
  }
  if (best.reading === null && attempts.length) {
    best.text = attempts[0].data?.text || '';
    best.confidence = Number(attempts[0].data?.confidence) || 0;
  }

  return best;
}

/** Frees the worker thread. Called when the capture screen closes. */
export async function terminateOcr() {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* already gone */
  }
}
