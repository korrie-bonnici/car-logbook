/**
 * Trip list and the edit/delete sheet.
 */
import {
  financialYearLabel,
  formatDate,
  formatTime,
  isInFinancialYear,
} from '../lib/dates.js';
import {
  financialYearsWithTrips,
  formatKm,
  isComplete,
  loadState,
  tripKm,
  validateNotes,
  validateReading,
} from '../lib/logbook.js';
import { deleteTrip, getPhoto, putTrip } from '../lib/db.js';
import { photoUrl } from '../lib/photo.js';
import { h, clear, confirmDialog, openModal, toast } from '../lib/ui.js';

const ALL_YEARS = 'all';

// Kept across re-renders so changing a trip does not reset the filter.
let activeFilter = ALL_YEARS;

export async function renderTrips({ navigate, refresh }) {
  const { trips } = await loadState();
  const completed = trips.filter(isComplete);
  const years = financialYearsWithTrips(trips);

  if (activeFilter !== ALL_YEARS && !years.includes(activeFilter)) {
    activeFilter = ALL_YEARS;
  }

  const visible =
    activeFilter === ALL_YEARS
      ? completed
      : completed.filter((t) => isInFinancialYear(t.start.at, activeFilter));

  const view = h('div', { class: 'view view--trips' });

  view.appendChild(
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Trips'),
      h(
        'p',
        { class: 'page-sub' },
        visible.length === 0
          ? 'No trips recorded'
          : `${visible.length} trip${visible.length === 1 ? '' : 's'} · ` +
              `${formatKm(visible.reduce((sum, t) => sum + tripKm(t), 0))} km`,
      ),
    ),
  );

  if (years.length > 1) {
    view.appendChild(renderFilter(years, refresh));
  }

  const openTrip = trips.find((t) => !t.end);
  if (openTrip) {
    view.appendChild(
      h(
        'div',
        { class: 'banner' },
        h(
          'div',
          { class: 'banner__text' },
          h('strong', null, 'Trip in progress'),
          h(
            'span',
            null,
            `Started ${formatDate(openTrip.start.at)} at ${formatKm(openTrip.start.odometer)} km.`,
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary',
            onclick: () => navigate('home'),
          },
          'Go to home',
        ),
      ),
    );
  }

  if (visible.length === 0) {
    view.appendChild(
      h(
        'div',
        { class: 'empty' },
        h('p', { class: 'empty__title' }, 'Nothing here yet'),
        h(
          'p',
          { class: 'empty__text' },
          'Completed trips appear here with their odometer photos.',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--primary',
            onclick: () => navigate('home'),
          },
          'Start a trip',
        ),
      ),
    );
    return view;
  }

  const list = h('ul', { class: 'trip-list' });
  for (const trip of visible) {
    list.appendChild(await renderTripRow(trip, refresh));
  }
  view.appendChild(list);

  return view;
}

function renderFilter(years, refresh) {
  const options = [
    { value: ALL_YEARS, label: 'All' },
    ...years.map((y) => ({ value: y, label: `FY ${financialYearLabel(y)}` })),
  ];

  return h(
    'div',
    { class: 'filter', role: 'group', 'aria-label': 'Filter by financial year' },
    ...options.map((option) =>
      h(
        'button',
        {
          type: 'button',
          class: `filter__chip ${activeFilter === option.value ? 'is-active' : ''}`,
          'aria-pressed': activeFilter === option.value ? 'true' : 'false',
          onclick: async () => {
            activeFilter = option.value;
            await refresh();
          },
        },
        option.label,
      ),
    ),
  );
}

async function renderTripRow(trip, refresh) {
  const [startPhoto, endPhoto] = await Promise.all([
    getPhoto(trip.start.photoId),
    getPhoto(trip.end?.photoId),
  ]);

  const km = tripKm(trip);

  return h(
    'li',
    { class: 'trip-list__item' },
    h(
      'button',
      {
        type: 'button',
        class: 'trip',
        onclick: () => openTripSheet(trip, { startPhoto, endPhoto, refresh }),
        'aria-label': `Trip on ${formatDate(trip.start.at)}, ${formatKm(km)} kilometres. Tap to edit.`,
      },
      h(
        'div',
        { class: 'trip__head' },
        h('span', { class: 'trip__date' }, formatDate(trip.start.at)),
        h(
          'span',
          { class: `pill ${trip.business ? 'pill--business' : 'pill--private'}` },
          trip.business ? 'Business' : 'Private',
        ),
        h('span', { class: 'trip__km' }, `${formatKm(km)} km`),
      ),
      h(
        'div',
        { class: 'trip__readings' },
        `${formatKm(trip.start.odometer)} → ${formatKm(trip.end.odometer)} km`,
        h(
          'span',
          { class: 'trip__times' },
          `${formatTime(trip.start.at)}–${formatTime(trip.end.at)}`,
        ),
      ),
      trip.notes ? h('p', { class: 'trip__notes' }, trip.notes) : null,
      h(
        'div',
        { class: 'trip__thumbs' },
        thumb(startPhoto, 'Start odometer'),
        thumb(endPhoto, 'End odometer'),
      ),
    ),
  );
}

function thumb(photo, label) {
  if (!photo) {
    return h('span', { class: 'thumb thumb--empty', title: `${label}: no photo` }, '—');
  }
  return h('img', {
    class: 'thumb',
    src: photoUrl(photo),
    alt: label,
    loading: 'lazy',
    decoding: 'async',
  });
}

/* ----------------------------------------------------------- edit sheet -- */

function openTripSheet(trip, { startPhoto, endPhoto, refresh }) {
  const draft = {
    startOdometer: String(trip.start.odometer),
    endOdometer: String(trip.end.odometer),
    notes: trip.notes || '',
    business: trip.business !== false,
  };

  return openModal((close) => {
    const errorHost = h('div', { class: 'modal__messages' });

    const save = async () => {
      clear(errorHost);
      const errors = [];

      const startCheck = validateReading(draft.startOdometer);
      if (!startCheck.ok) errors.push(`Start reading: ${startCheck.error}`);

      const endCheck = validateReading(draft.endOdometer);
      if (!endCheck.ok) errors.push(`End reading: ${endCheck.error}`);

      const start = Number(draft.startOdometer);
      const end = Number(draft.endOdometer);
      if (startCheck.ok && endCheck.ok && end <= start) {
        errors.push('End reading must be higher than the start reading.');
      }

      const notesCheck = validateNotes(draft.notes);
      if (!notesCheck.ok) errors.push(notesCheck.error);

      if (errors.length) {
        for (const message of errors) {
          errorHost.appendChild(
            h('p', { class: 'message message--error', role: 'alert' }, message),
          );
        }
        return;
      }

      await putTrip({
        ...trip,
        start: { ...trip.start, odometer: start },
        end: { ...trip.end, odometer: end },
        notes: draft.notes.trim(),
        business: draft.business,
      });
      close(true);
      toast('Trip updated.', { type: 'success' });
      await refresh();
    };

    const remove = async () => {
      const ok = await confirmDialog({
        title: 'Delete this trip?',
        body: `The ${formatDate(trip.start.at)} trip and both odometer photos will be removed. This cannot be undone.`,
        confirmLabel: 'Delete trip',
        destructive: true,
      });
      if (!ok) return;
      await deleteTrip(trip.id);
      close(true);
      toast('Trip deleted.');
      await refresh();
    };

    return [
      h('h2', { class: 'modal__title', id: 'modal-title' }, formatDate(trip.start.at)),
      h(
        'p',
        { class: 'modal__sub' },
        `${formatTime(trip.start.at)}–${formatTime(trip.end.at)} · ${formatKm(tripKm(trip))} km`,
      ),

      h(
        'div',
        { class: 'photo-pair' },
        photoPanel(startPhoto, 'Start', trip.start),
        photoPanel(endPhoto, 'End', trip.end),
      ),

      numberField('Start odometer', draft.startOdometer, (value) => {
        draft.startOdometer = value;
      }),
      numberField('End odometer', draft.endOdometer, (value) => {
        draft.endOdometer = value;
      }),

      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Type of use'),
        h(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': 'Type of use' },
          ...[
            { label: 'Business', value: true },
            { label: 'Private', value: false },
          ].map((option) =>
            h(
              'button',
              {
                type: 'button',
                class: `segmented__option ${draft.business === option.value ? 'is-active' : ''}`,
                'aria-pressed': draft.business === option.value ? 'true' : 'false',
                onclick: (event) => {
                  draft.business = option.value;
                  const group = event.currentTarget.parentElement;
                  for (const node of group.children) {
                    const active = node === event.currentTarget;
                    node.classList.toggle('is-active', active);
                    node.setAttribute('aria-pressed', active ? 'true' : 'false');
                  }
                },
              },
              option.label,
            ),
          ),
        ),
      ),

      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field__label', for: 'edit-notes' }, 'Purpose'),
        h('textarea', {
          id: 'edit-notes',
          class: 'field__input field__textarea',
          rows: '3',
          maxlength: '500',
          value: draft.notes,
          oninput: (event) => {
            draft.notes = event.target.value;
          },
        }),
      ),

      errorHost,

      h(
        'div',
        { class: 'modal__actions modal__actions--stack' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: save }, 'Save changes'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => close(false) }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn--danger-quiet', onclick: remove }, 'Delete trip'),
      ),
    ];
  });
}

function photoPanel(photo, label, reading) {
  return h(
    'figure',
    { class: 'photo-pair__item' },
    photo
      ? h('img', {
          class: 'photo-pair__img',
          src: photoUrl(photo),
          alt: `${label} odometer photo`,
          loading: 'lazy',
        })
      : h('div', { class: 'photo-pair__missing' }, 'No photo'),
    h(
      'figcaption',
      { class: 'photo-pair__cap' },
      `${label} · ${formatTime(reading?.at)}`,
    ),
  );
}

function numberField(label, value, onChange) {
  const id = `field-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field__label', for: id }, label),
    h(
      'div',
      { class: 'field__row' },
      h('input', {
        id,
        class: 'field__input',
        type: 'text',
        inputmode: 'numeric',
        pattern: '[0-9]*',
        autocomplete: 'off',
        value,
        oninput: (event) => {
          const cleaned = event.target.value.replace(/[^0-9]/g, '').slice(0, 7);
          event.target.value = cleaned;
          onChange(cleaned);
        },
      }),
      h('span', { class: 'field__suffix' }, 'km'),
    ),
  );
}
