/**
 * The photo-then-confirm odometer screen.
 *
 * Used by all four capture points: trip start, trip end, logbook period start
 * and logbook period end. It opens the rear camera, compresses the result,
 * runs OCR in the background and puts the guess in an editable field beside
 * the photo so it can be corrected before saving.
 *
 * OCR never blocks. If it is slow, offline or wrong, the field is already
 * there to type into.
 */
import { captureOdometerPhoto, compressPhoto, formatBytes, photoUrl } from '../lib/photo.js';
import { readOdometer } from '../lib/ocr.js';
import { validateNotes } from '../lib/logbook.js';
import { formatDateTime } from '../lib/dates.js';
import { h, clear, toast } from '../lib/ui.js';

/**
 * Opens the capture screen.
 *
 * Resolves with { odometer, at, photo, notes, business } or null if cancelled.
 * `photo` is an un-saved photo record; the caller persists it.
 */
export function captureReading({
  title,
  hint = '',
  submitLabel = 'Save',
  validate = () => ({ ok: true, errors: [], warnings: [] }),
  requireNotes = false,
  notesLabel = 'Purpose of this trip',
  notesHint = 'The ATO needs a reason recorded for every business trip.',
  initialNotes = '',
  showBusiness = false,
  initialBusiness = true,
} = {}) {
  return new Promise((resolve) => {
    const state = {
      photo: null,
      capturedAt: null,
      odometer: '',
      touched: false,
      notes: initialNotes,
      business: initialBusiness,
      ocr: 'idle', // idle | running | done | failed | unavailable
      ocrConfidence: null,
      acknowledgedWarnings: false,
    };

    const screen = h('div', { class: 'capture', role: 'dialog', 'aria-modal': 'true' });
    document.body.appendChild(screen);
    document.body.classList.add('is-modal-open');

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeydown, true);
      screen.remove();
      document.body.classList.remove('is-modal-open');
      resolve(result);
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    };
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
          h('h1', { class: 'capture__title' }, title),
        ),
      );

      const body = h('div', { class: 'capture__body' });
      screen.appendChild(body);

      if (!state.photo) {
        body.appendChild(renderEmpty());
      } else {
        body.appendChild(renderConfirm());
      }
    }

    /* ------------------------------------------------- step 1: the photo */

    function renderEmpty() {
      return h(
        'div',
        { class: 'capture__empty' },
        h('div', { class: 'capture__placeholder', 'aria-hidden': 'true' }, '\u{1F4F7}'),
        h('p', { class: 'capture__hint' }, hint || 'Photograph the odometer to begin.'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--primary btn--xl',
            autofocus: true,
            onclick: takePhoto,
          },
          'Open camera',
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost', onclick: () => finish(null) },
          'Cancel',
        ),
      );
    }

    async function takePhoto() {
      const file = await captureOdometerPhoto();
      if (!file) return; // cancelled in the camera app

      // Capture time is the moment the shutter fired, near enough.
      state.capturedAt = new Date().toISOString();

      try {
        state.photo = await compressPhoto(file);
      } catch (err) {
        console.error(err);
        toast('Could not process that photo. Try again.', { type: 'error' });
        return;
      }

      state.ocr = 'running';
      render();
      runOcr();
    }

    async function runOcr() {
      const photoAtStart = state.photo;
      try {
        const result = await readOdometer(photoAtStart.blob);
        // The user may have retaken the photo while OCR was running.
        if (state.photo !== photoAtStart) return;

        state.ocrConfidence = result.confidence;
        if (result.reading !== null) {
          state.ocr = 'done';
          // Never overwrite something the user has already typed.
          if (!state.touched) state.odometer = String(result.reading);
        } else {
          state.ocr = 'failed';
        }
      } catch (err) {
        console.warn('[capture] OCR unavailable', err);
        if (state.photo !== photoAtStart) return;
        state.ocr = 'unavailable';
      }
      render();
      focusOdometer();
    }

    function focusOdometer() {
      const field = screen.querySelector('#odometer-field');
      if (field instanceof HTMLInputElement && !state.touched) {
        field.focus();
        field.select();
      }
    }

    /* ----------------------------------------------- step 2: the confirm */

    function renderConfirm() {
      const wrap = h('div', { class: 'capture__confirm' });

      wrap.appendChild(
        h(
          'figure',
          { class: 'capture__figure' },
          h('img', {
            class: 'capture__photo',
            src: photoUrl(state.photo),
            alt: 'Odometer photo just taken',
          }),
          h(
            'figcaption',
            { class: 'capture__caption' },
            `${formatDateTime(state.capturedAt)} · ${formatBytes(state.photo.bytes)}`,
          ),
        ),
      );

      wrap.appendChild(renderOcrStatus());

      const field = h('input', {
        id: 'odometer-field',
        class: 'field__input field__input--odometer',
        type: 'text',
        inputmode: 'numeric',
        pattern: '[0-9]*',
        autocomplete: 'off',
        enterkeyhint: 'done',
        'aria-describedby': 'odometer-help',
        value: state.odometer,
        oninput: (event) => {
          const cleaned = event.target.value.replace(/[^0-9]/g, '').slice(0, 7);
          event.target.value = cleaned;
          state.odometer = cleaned;
          state.touched = true;
          state.acknowledgedWarnings = false;
          clearMessages();
        },
      });

      wrap.appendChild(
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field__label', for: 'odometer-field' }, 'Odometer reading'),
          h(
            'div',
            { class: 'field__row' },
            field,
            h('span', { class: 'field__suffix' }, 'km'),
          ),
          h(
            'p',
            { class: 'field__help', id: 'odometer-help' },
            'Check it against the photo before saving.',
          ),
        ),
      );

      if (showBusiness) {
        wrap.appendChild(
          h(
            'div',
            { class: 'field' },
            h('span', { class: 'field__label' }, 'Type of use'),
            h(
              'div',
              { class: 'segmented', role: 'group', 'aria-label': 'Type of use' },
              segmentButton('Business', true),
              segmentButton('Private', false),
            ),
            h(
              'p',
              { class: 'field__help' },
              'Only business trips count towards your business use percentage.',
            ),
          ),
        );
      }

      if (requireNotes) {
        wrap.appendChild(
          h(
            'div',
            { class: 'field' },
            h('label', { class: 'field__label', for: 'notes-field' }, notesLabel),
            h('textarea', {
              id: 'notes-field',
              class: 'field__input field__textarea',
              rows: '3',
              maxlength: '500',
              placeholder: 'e.g. Site visit, 42 Smith St Parramatta',
              enterkeyhint: 'done',
              value: state.notes,
              oninput: (event) => {
                state.notes = event.target.value;
                clearMessages();
              },
            }),
            h('p', { class: 'field__help' }, notesHint),
          ),
        );
      }

      wrap.appendChild(h('div', { class: 'capture__messages', id: 'capture-messages' }));

      wrap.appendChild(
        h(
          'div',
          { class: 'capture__actions' },
          h(
            'button',
            { type: 'button', class: 'btn btn--primary btn--xl', onclick: submit },
            submitLabel,
          ),
          h(
            'button',
            { type: 'button', class: 'btn btn--ghost', onclick: retake },
            'Retake photo',
          ),
          h(
            'button',
            { type: 'button', class: 'btn btn--ghost', onclick: () => finish(null) },
            'Cancel',
          ),
        ),
      );

      return wrap;
    }

    function segmentButton(label, value) {
      const active = state.business === value;
      return h(
        'button',
        {
          type: 'button',
          class: `segmented__option ${active ? 'is-active' : ''}`,
          'aria-pressed': active ? 'true' : 'false',
          onclick: () => {
            state.business = value;
            render();
          },
        },
        label,
      );
    }

    function renderOcrStatus() {
      const map = {
        running: { text: 'Reading the digits…', tone: 'busy' },
        done: {
          // Tesseract does not always report a confidence. Showing "0%"
          // would read as a failure when the digits are in fact correct.
          text:
            state.ocrConfidence > 0
              ? `Read from the photo, ${Math.round(state.ocrConfidence)}% confident. Check it against the photo.`
              : 'Read from the photo. Check it against the photo.',
          tone: state.ocrConfidence > 0 && state.ocrConfidence < 60 ? 'warn' : 'ok',
        },
        failed: { text: 'Could not read the digits. Type the reading below.', tone: 'warn' },
        unavailable: {
          text: 'Text recognition is unavailable offline the first time. Type the reading below.',
          tone: 'warn',
        },
      };
      const status = map[state.ocr];
      if (!status) return null;

      return h(
        'p',
        { class: `ocr-status ocr-status--${status.tone}`, role: 'status' },
        status.tone === 'busy'
          ? h('span', { class: 'ocr-status__spinner', 'aria-hidden': 'true' })
          : null,
        status.text,
      );
    }

    async function retake() {
      state.photo = null;
      state.ocr = 'idle';
      state.ocrConfidence = null;
      // A corrected number survives a retake; an OCR guess does not.
      if (!state.touched) state.odometer = '';
      render();
      await takePhoto();
    }

    /* ------------------------------------------------------- validation */

    function clearMessages() {
      const host = screen.querySelector('#capture-messages');
      if (host) clear(host);
    }

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
          h(
            'p',
            { class: 'message message--hint' },
            'Tap save again to record it anyway.',
          ),
        );
      }
      host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function submit() {
      const errors = [];
      const warnings = [];

      const reading = validate(state.odometer);
      errors.push(...(reading.errors || []));
      warnings.push(...(reading.warnings || []));

      if (requireNotes) {
        const notes = validateNotes(state.notes);
        if (!notes.ok) errors.push(notes.error);
      }

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

      finish({
        odometer: Number(state.odometer),
        at: state.capturedAt,
        photo: state.photo,
        notes: String(state.notes || '').trim(),
        business: state.business,
      });
    }

    /* -------------------------------------------------------------- go */

    render();
    // Jump straight to the camera: that is why you opened this screen.
    takePhoto();
  });
}
