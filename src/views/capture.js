/**
 * The photo-then-confirm odometer screen, used at both ends of a trip.
 *
 * It opens the rear camera, reads the digits in the background and puts the
 * guess in an editable field under the photo. At the end of a trip a second
 * step shows the distance and asks for the purpose. The photo is only held
 * in memory while this screen is open; it is never saved.
 *
 * Reading the digits never blocks. If it is slow, offline or wrong, the
 * field is already there to type into.
 */
import { captureOdometerPhoto } from '../lib/photo.js';
import { readOdometer } from '../lib/ocr.js';
import { formatKm, validatePurpose, PURPOSE_MAX_LENGTH } from '../lib/trip.js';
import { formatTime } from '../lib/dates.js';
import { h, clear, pushBackLayer, toast } from '../lib/ui.js';

/**
 * Opens the capture screen.
 *
 * `near` is the last known reading, which helps pick the right number off
 * the photo. With `startOdometer`, a purpose step follows the reading.
 *
 * Resolves with { odometer, at, purpose } or null if cancelled.
 */
export function captureReading({
  title,
  hint = '',
  submitLabel = 'Save',
  validate = () => ({ ok: true, errors: [], warnings: [] }),
  near = null,
  startOdometer = null,
}) {
  const askPurpose = Number.isFinite(startOdometer);

  return new Promise((resolve) => {
    const state = {
      step: 'photo', // photo | confirm | purpose
      file: null,
      url: null,
      capturedAt: null,
      odometer: '',
      touched: false,
      ocr: 'idle', // idle | running | done | failed | unavailable
      ocrConfidence: null,
      acknowledgedWarnings: false,
      purpose: '',
    };

    const screen = h('div', {
      class: 'capture',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'capture-title',
    });
    document.body.appendChild(screen);
    document.body.classList.add('is-modal-open');

    let release = pushBackLayer(onBack);
    let settled = false;

    function onBack() {
      // Back on the purpose step returns to the reading rather than
      // throwing the whole trip end away.
      if (state.step === 'purpose' && !settled) {
        state.step = 'confirm';
        render();
        release = pushBackLayer(onBack);
        return;
      }
      finish(null);
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      release();
      document.removeEventListener('keydown', onKeydown, true);
      if (state.url) URL.revokeObjectURL(state.url);
      screen.remove();
      document.body.classList.remove('is-modal-open');
      resolve(result);
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
      }
    }
    document.addEventListener('keydown', onKeydown, true);

    /* ------------------------------------------------------------ render */

    function render() {
      clear(screen);
      screen.appendChild(
        h(
          'header',
          { class: 'capture__bar' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--icon',
              'aria-label': 'Cancel',
              onclick: () => finish(null),
            },
            '✕',
          ),
          h('h1', { class: 'capture__title', id: 'capture-title' }, title),
        ),
      );

      const body = h('div', { class: 'capture__body' });
      if (state.step === 'photo') body.appendChild(renderPhotoStep());
      else if (state.step === 'confirm') body.appendChild(renderConfirmStep());
      else body.appendChild(renderPurposeStep());
      screen.appendChild(body);

      const target = screen.querySelector('[autofocus]');
      if (target instanceof HTMLElement) requestAnimationFrame(() => target.focus());
    }

    /* ------------------------------------------------- step 1: the photo */

    function renderPhotoStep() {
      return h(
        'div',
        { class: 'capture__empty' },
        h('div', { class: 'capture__placeholder', 'aria-hidden': 'true' }, '\u{1F4F7}'),
        h('p', { class: 'capture__hint' }, hint || 'Photograph the odometer.'),
        h(
          'button',
          { type: 'button', class: 'btn btn--primary btn--xl', autofocus: true, onclick: takePhoto },
          'Open camera',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost',
            onclick: () => {
              state.step = 'confirm';
              render();
            },
          },
          'Type the reading instead',
        ),
      );
    }

    async function takePhoto() {
      const file = await captureOdometerPhoto();
      if (!file || settled) return;

      if (state.url) URL.revokeObjectURL(state.url);
      state.file = file;
      state.url = URL.createObjectURL(file);
      state.capturedAt = new Date().toISOString();
      state.ocr = 'running';
      state.ocrConfidence = null;
      state.step = 'confirm';
      render();
      runOcr(file);
    }

    async function runOcr(file) {
      try {
        const result = await readOdometer(file, { near });
        if (state.file !== file || settled) return; // retaken meanwhile
        state.ocrConfidence = result.confidence;
        if (result.reading !== null) {
          state.ocr = 'done';
          if (!state.touched) state.odometer = String(result.reading);
        } else {
          state.ocr = 'failed';
        }
      } catch (err) {
        console.warn('[capture] OCR unavailable', err);
        if (state.file !== file || settled) return;
        state.ocr = 'unavailable';
      }
      if (state.step === 'confirm') showOcrResult();
    }

    /**
     * Updates the status line and the reading in place rather than
     * redrawing, so focus and anything half typed are left alone.
     */
    function showOcrResult() {
      const status = screen.querySelector('#ocr-status');
      if (status) status.replaceWith(renderOcrStatus());

      const field = screen.querySelector('#odometer-field');
      if (!(field instanceof HTMLInputElement) || state.touched) return;
      field.value = state.odometer;
      const nothingFocused =
        document.activeElement === document.body || document.activeElement === null;
      if (nothingFocused) {
        field.focus();
        field.select();
      }
    }

    /* ----------------------------------------------- step 2: the reading */

    function renderConfirmStep() {
      const wrap = h('div', { class: 'capture__confirm' });

      if (state.url) {
        wrap.appendChild(
          h(
            'figure',
            { class: 'capture__figure' },
            h('img', { class: 'capture__photo', src: state.url, alt: 'Odometer photo just taken' }),
          ),
        );
      }

      wrap.appendChild(renderOcrStatus());

      wrap.appendChild(
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field__label', for: 'odometer-field' }, 'Odometer reading'),
          h(
            'div',
            { class: 'field__row' },
            h('input', {
              id: 'odometer-field',
              class: 'field__input field__input--odometer',
              type: 'text',
              inputmode: 'numeric',
              pattern: '[0-9]*',
              autocomplete: 'off',
              enterkeyhint: 'done',
              'aria-describedby': 'odometer-help',
              value: state.odometer,
              autofocus: !state.url,
              oninput: (event) => {
                const cleaned = event.target.value.replace(/[^0-9]/g, '').slice(0, 7);
                event.target.value = cleaned;
                state.odometer = cleaned;
                state.touched = true;
                state.acknowledgedWarnings = false;
                showMessages([], []);
              },
              onkeydown: (event) => {
                if (event.key === 'Enter') submitReading();
              },
            }),
            h('span', { class: 'field__suffix' }, 'km'),
          ),
          h(
            'p',
            { class: 'field__help', id: 'odometer-help' },
            state.url ? 'Check it against the photo.' : 'Type the number on the odometer.',
          ),
        ),
      );

      wrap.appendChild(h('div', { class: 'capture__messages', id: 'capture-messages' }));

      wrap.appendChild(
        h(
          'div',
          { class: 'capture__actions' },
          h(
            'button',
            { type: 'button', class: 'btn btn--primary btn--xl', onclick: submitReading },
            askPurpose ? 'Next' : submitLabel,
          ),
          h(
            'button',
            { type: 'button', class: 'btn btn--ghost', onclick: takePhoto },
            state.url ? 'Retake photo' : 'Take a photo instead',
          ),
        ),
      );

      return wrap;
    }

    function renderOcrStatus() {
      const map = {
        running: { text: 'Reading the digits…', tone: 'busy' },
        done: {
          text: 'Read from the photo. Check it before saving.',
          tone: state.ocrConfidence > 0 && state.ocrConfidence < 60 ? 'warn' : 'ok',
        },
        failed: { text: 'Could not read the digits. Type the reading below.', tone: 'warn' },
        unavailable: {
          text: navigator.onLine
            ? 'Text recognition did not load. Type the reading below.'
            : 'Text recognition needs a connection the first time. Type the reading below.',
          tone: 'warn',
        },
      };
      const status = map[state.ocr];
      if (!status) return h('span', { id: 'ocr-status', hidden: true });

      return h(
        'p',
        { class: `ocr-status ocr-status--${status.tone}`, role: 'status', id: 'ocr-status' },
        status.tone === 'busy'
          ? h('span', { class: 'ocr-status__spinner', 'aria-hidden': 'true' })
          : null,
        status.text,
      );
    }

    function submitReading() {
      const result = validate(state.odometer);
      const errors = result.errors || [];
      const warnings = result.warnings || [];

      if (errors.length) {
        state.acknowledgedWarnings = false;
        showMessages(errors, warnings);
        return;
      }
      // Warnings are advisory: show once, then let a second tap through.
      if (warnings.length && !state.acknowledgedWarnings) {
        state.acknowledgedWarnings = true;
        showMessages([], warnings);
        return;
      }

      if (!state.capturedAt) state.capturedAt = new Date().toISOString();

      if (askPurpose) {
        state.step = 'purpose';
        render();
        return;
      }
      finish({ odometer: Number(state.odometer), at: state.capturedAt, purpose: '' });
    }

    /* ----------------------------------------------- step 3: the purpose */

    function renderPurposeStep() {
      const km = Number(state.odometer) - startOdometer;

      return h(
        'div',
        { class: 'capture__confirm' },
        h(
          'div',
          { class: 'distance' },
          h('span', { class: 'distance__value' }, `${formatKm(km)} km`),
          h('span', { class: 'distance__label' }, 'travelled'),
          h(
            'span',
            { class: 'distance__detail' },
            `${formatKm(startOdometer)} → ${formatKm(Number(state.odometer))} km · ` +
              `ended ${formatTime(state.capturedAt)}`,
          ),
        ),
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field__label', for: 'purpose-field' }, 'Purpose of this trip'),
          h('textarea', {
            id: 'purpose-field',
            class: 'field__input field__textarea',
            rows: '3',
            maxlength: String(PURPOSE_MAX_LENGTH),
            placeholder: 'e.g. Site visit, 42 Smith St Parramatta',
            autofocus: true,
            value: state.purpose,
            oninput: (event) => {
              state.purpose = event.target.value;
              showMessages([], []);
            },
          }),
          h(
            'p',
            { class: 'field__help' },
            'Who or where, and why. Your accountant needs this for every trip.',
          ),
        ),
        h('div', { class: 'capture__messages', id: 'capture-messages' }),
        h(
          'div',
          { class: 'capture__actions' },
          h(
            'button',
            { type: 'button', class: 'btn btn--primary btn--xl', onclick: submitPurpose },
            submitLabel,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost',
              onclick: () => {
                state.step = 'confirm';
                render();
              },
            },
            'Change the reading',
          ),
        ),
      );
    }

    function submitPurpose() {
      const check = validatePurpose(state.purpose);
      if (!check.ok) {
        showMessages([check.error], []);
        return;
      }
      finish({
        odometer: Number(state.odometer),
        at: state.capturedAt,
        purpose: state.purpose.trim(),
      });
    }

    /* ---------------------------------------------------------- messages */

    function showMessages(errors, warnings) {
      const host = screen.querySelector('#capture-messages');
      if (!host) return;
      clear(host);
      for (const message of errors) {
        host.appendChild(h('p', { class: 'message message--error', role: 'alert' }, message));
      }
      for (const message of warnings) {
        host.appendChild(h('p', { class: 'message message--warn' }, message));
      }
      if (warnings.length && !errors.length) {
        host.appendChild(
          h('p', { class: 'message message--hint' }, 'Tap again to record it anyway.'),
        );
      }
      if (errors.length || warnings.length) {
        host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    /* -------------------------------------------------------------- go */

    render();

    // Jump straight to the camera, which is why this screen was opened. A
    // browser only opens it in response to a tap, so when there was none
    // (a home-screen shortcut) the Open camera button does it instead.
    if (navigator.userActivation?.isActive !== false) {
      takePhoto().catch((err) => {
        console.error(err);
        toast('Could not open the camera.', { type: 'error' });
      });
    }
  });
}
