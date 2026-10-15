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
 * Grayscale + contrast stretch at 2x scale. Odometer photos are usually dim
 * and low-contrast behind glass, and this lifts recognition noticeably.
 */
async function preprocess(blob) {
  const bitmap = await createImageBitmap(blob).catch(() => null);
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

  // Pass one: luminance, and track the range actually used.
  let min = 255;
  let max = 0;
  const grey = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, g = 0; i < px.length; i += 4, g += 1) {
    const value = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    grey[g] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // Pass two: stretch that range back out to full black-to-white.
  const span = Math.max(1, max - min);
  for (let i = 0, g = 0; i < px.length; i += 4, g += 1) {
    const value = ((grey[g] - min) * 255) / span;
    px[i] = value;
    px[i + 1] = value;
    px[i + 2] = value;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((out) => resolve(out || blob), 'image/png');
  });
}

/**
 * Picks the most odometer-looking number out of raw OCR text.
 * Odometers run 3 to 7 digits; anything outside that is noise.
 */
function pickReading(text) {
  if (!text) return null;
  const runs = String(text).match(/\d+/g);
  if (!runs || runs.length === 0) return null;

  const candidates = runs
    .map((run) => run.replace(/^0+(?=\d)/, '')) // drop leading zeros
    .filter((run) => run.length >= 3 && run.length <= 7)
    .map((run) => Number.parseInt(run, 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 9_999_999);

  if (candidates.length === 0) return null;

  // The odometer is the longest run on the dial; ties go to the larger value.
  return candidates.sort((a, b) => {
    const lengthDiff = String(b).length - String(a).length;
    return lengthDiff !== 0 ? lengthDiff : b - a;
  })[0];
}

/**
 * Reads an odometer from a photo blob.
 *
 * Resolves with { reading, confidence, text } where reading may be null.
 * Never throws for recognition failure; only for an engine that would not load.
 */
export async function readOdometer(blob, { onProgress } = {}) {
  const worker = await getWorker(onProgress);
  const prepared = await preprocess(blob);

  const attempts = [];

  const first = await worker.recognize(prepared);
  attempts.push({ psm: PSM_SINGLE_BLOCK, data: first.data });

  // If a single block gave us nothing usable, try treating it as one line.
  if (!pickReading(first.data?.text)) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM_SINGLE_LINE });
    const second = await worker.recognize(prepared);
    attempts.push({ psm: PSM_SINGLE_LINE, data: second.data });
    await worker.setParameters({ tessedit_pageseg_mode: PSM_SINGLE_BLOCK });
  }

  let best = { reading: null, confidence: 0, text: '' };
  for (const attempt of attempts) {
    const reading = pickReading(attempt.data?.text);
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
