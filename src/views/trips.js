/**
 * Trip list and the edit/delete sheet.
 */
import { financialYearLabel, formatDate, formatTime, isInFinancialYear } from '../lib/dates.js';
import { deleteTrip, loadState, updateTrip } from '../lib/logbook.js';
import {
  financialYearsWithTrips,
  formatKm,
  isComplete,
  tripKm,
  validatePurpose,
  validateReading,
  PURPOSE_MAX_LENGTH,
} from '../lib/trip.js';
import { h, clear, confirmDialog, openModal, toast } from '../lib/ui.js';

const ALL_YEARS = 'all';

// Kept across re-renders so editing a trip does not reset the filter.
let activeFilter = ALL_YEARS;

export async function renderTrips({ navigate, refresh }) {
  const { trips, openTrip } = await loadState();
  const completed = trips.filter(isComplete);
  const years = financialYearsWithTrips(trips);

  if (activeFilter !== ALL_YEARS && !years.includes(activeFilter)) activeFilter = ALL_YEARS;

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

  if (years.length > 1) view.appendChild(renderFilter(years, refresh));

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
          { type: 'button', class: 'btn btn--secondary', onclick: () => navigate('home') },
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
        h('p', { class: 'empty__text' }, 'Finished trips appear here.'),
        h(
          'button',
          { type: 'button', class: 'btn btn--primary', onclick: () => navigate('home') },
          'Start a trip',
        ),
      ),
    );
    return view;
  }

  view.appendChild(
    h('ul', { class: 'trip-list' }, ...visible.map((trip) => renderTripRow(trip, refresh))),
  );
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

function renderTripRow(trip, refresh) {
  const km = tripKm(trip);

  return h(
    'li',
    { class: 'trip-list__item' },
    h(
      'button',
      {
        type: 'button',
        class: 'trip',
        onclick: () => openTripSheet(trip, refresh),
        'aria-label': `Trip on ${formatDate(trip.start.at)}, ${formatKm(km)} kilometres. Tap to edit.`,
      },
      h(
        'div',
        { class: 'trip__head' },
        h('span', { class: 'trip__date' }, formatDate(trip.start.at)),
        h('span', { class: 'trip__km' }, `${formatKm(km)} km`),
      ),
      h(
        'div',
        { class: 'trip__readings' },
        `${formatKm(trip.start.odometer)} → ${formatKm(trip.end.odometer)} km`,
        h('span', { class: 'trip__times' }, `${formatTime(trip.start.at)}–${formatTime(trip.end.at)}`),
      ),
      trip.purpose ? h('p', { class: 'trip__notes' }, trip.purpose) : null,
    ),
  );
}

/* ----------------------------------------------------------- edit sheet -- */

function openTripSheet(trip, refresh) {
  const draft = {
    startOdometer: String(trip.start.odometer),
    endOdometer: String(trip.end.odometer),
    purpose: trip.purpose || '',
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
        errors.push('The end reading must be higher than the start reading.');
      }

      const purposeCheck = validatePurpose(draft.purpose);
      if (!purposeCheck.ok) errors.push(purposeCheck.error);

      if (errors.length) {
        for (const message of errors) {
          errorHost.appendChild(h('p', { class: 'message message--error', role: 'alert' }, message));
        }
        return;
      }

      await updateTrip(trip.id, {
        start: { ...trip.start, odometer: start },
        end: { ...trip.end, odometer: end },
        purpose: draft.purpose.trim(),
      });
      close(true);
      toast('Trip updated.', { type: 'success' });
      await refresh();
    };

    const remove = async () => {
      const ok = await confirmDialog({
        title: 'Delete this trip?',
        body: `The ${formatDate(trip.start.at)} trip will be removed. This cannot be undone.`,
        confirmLabel: 'Delete trip',
        destructive: true,
      });
      if (!ok) return;
      await deleteTrip(trip.id);
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

      numberField('Start odometer', draft.startOdometer, (value) => {
        draft.startOdometer = value;
      }),
      numberField('End odometer', draft.endOdometer, (value) => {
        draft.endOdometer = value;
      }),

      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field__label', for: 'edit-purpose' }, 'Purpose'),
        h('textarea', {
          id: 'edit-purpose',
          class: 'field__input field__textarea',
          rows: '3',
          maxlength: String(PURPOSE_MAX_LENGTH),
          value: draft.purpose,
          oninput: (event) => {
            draft.purpose = event.target.value;
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
