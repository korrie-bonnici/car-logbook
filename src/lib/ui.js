/**
 * Tiny DOM toolkit: an element builder, toasts and a modal.
 *
 * Everything builds real nodes and sets text through textContent, so a trip
 * purpose containing angle brackets is just text, never markup.
 */

/* --------------------------------------------------------------- hyper -- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline']);

/**
 * h('div', { class: 'card' }, 'text', childNode)
 *
 * Props: `class`, `style` (string or object), `dataset`, `on*` listeners,
 * `html` for trusted markup, anything else becomes an attribute or property.
 */
export function h(tag, props = null, ...children) {
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === 'class' || key === 'className') {
        el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key === 'html') {
        el.innerHTML = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled') {
        el[key] = value;
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, value);
      }
    }
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* -------------------------------------------------------------- toasts -- */

let toastTimer = null;

export function toast(message, { type = 'info', duration = 3800 } = {}) {
  const host = document.getElementById('toast-host');
  if (!host) return;

  clear(host);
  const node = h('div', { class: `toast toast--${type}`, role: 'status' }, message);
  host.appendChild(node);

  requestAnimationFrame(() => node.classList.add('is-visible'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 250);
  }, duration);
}

/* --------------------------------------------------------------- modal -- */

let closeActiveModal = null;

/**
 * Opens a modal. `render` receives a `close(result)` function and returns
 * the body content. Resolves with whatever close() was given.
 */
export function openModal(render, { labelledBy = 'modal-title', dismissible = true } = {}) {
  const host = document.getElementById('modal-host');
  if (!host) return Promise.resolve(undefined);

  // Only one at a time; a second request replaces the first.
  if (closeActiveModal) closeActiveModal(undefined);

  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;

    const close = (result) => {
      if (closeActiveModal !== close) return;
      closeActiveModal = null;
      document.removeEventListener('keydown', onKeydown, true);
      host.hidden = true;
      clear(host);
      document.body.classList.remove('is-modal-open');
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(result);
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        close(undefined);
      }
      if (event.key === 'Tab') trapFocus(event, panel);
    };

    const panel = h(
      'div',
      {
        class: 'modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': labelledBy,
      },
      render(close),
    );

    const backdrop = h('div', {
      class: 'modal-backdrop',
      onclick: () => dismissible && close(undefined),
    });

    clear(host);
    host.appendChild(backdrop);
    host.appendChild(panel);
    host.hidden = false;
    document.body.classList.add('is-modal-open');

    closeActiveModal = close;
    document.addEventListener('keydown', onKeydown, true);

    requestAnimationFrame(() => {
      const target =
        panel.querySelector('[autofocus]') ||
        panel.querySelector('input, textarea, button');
      if (target instanceof HTMLElement) target.focus();
    });
  });
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(event, panel) {
  const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Yes/no dialog. Resolves true only on an explicit confirm. */
export function confirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}) {
  return openModal((close) => [
    h('h2', { class: 'modal__title', id: 'modal-title' }, title),
    typeof body === 'string'
      ? h('p', { class: 'modal__body' }, body)
      : h('div', { class: 'modal__body' }, body),
    h(
      'div',
      { class: 'modal__actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost', onclick: () => close(false) },
        cancelLabel,
      ),
      h(
        'button',
        {
          type: 'button',
          class: `btn ${destructive ? 'btn--danger' : 'btn--primary'}`,
          autofocus: !destructive,
          onclick: () => close(true),
        },
        confirmLabel,
      ),
    ),
  ]).then((result) => result === true);
}

/** Informational dialog with a single dismiss button. */
export function alertDialog({ title, body, dismissLabel = 'OK' }) {
  return openModal((close) => [
    h('h2', { class: 'modal__title', id: 'modal-title' }, title),
    typeof body === 'string'
      ? h('p', { class: 'modal__body' }, body)
      : h('div', { class: 'modal__body' }, body),
    h(
      'div',
      { class: 'modal__actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn--primary', autofocus: true, onclick: () => close(true) },
        dismissLabel,
      ),
    ),
  ]);
}

/* ------------------------------------------------------------- spinner -- */

export function spinner(label = 'Working') {
  return h(
    'div',
    { class: 'spinner', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'spinner__ring', 'aria-hidden': 'true' }),
    h('span', { class: 'spinner__label' }, label),
  );
}

/** Wraps an async action with a busy state on the triggering button. */
export async function withBusy(button, label, fn) {
  if (!button) return fn();
  const original = button.textContent;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.classList.add('is-busy');
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = wasDisabled;
    button.classList.remove('is-busy');
    button.textContent = original;
  }
}

/* ------------------------------------------------------------- helpers -- */

export function icon(name) {
  const paths = {
    camera:
      'M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    home: 'M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z',
    list: 'M4 6h16M4 12h16M4 18h16',
    settings:
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm9-3a8.9 8.9 0 0 0-.2-1.8l2-1.5-2-3.4-2.3 1a9 9 0 0 0-3.1-1.8L15 2H9l-.4 2.5a9 9 0 0 0-3.1 1.8l-2.3-1-2 3.4 2 1.5a9 9 0 0 0 0 3.6l-2 1.5 2 3.4 2.3-1a9 9 0 0 0 3.1 1.8L9 22h6l.4-2.5a9 9 0 0 0 3.1-1.8l2.3 1 2-3.4-2-1.5c.1-.6.2-1.2.2-1.8Z',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  };
  return h(
    'svg',
    {
      class: 'icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: paths[name] || '' }),
  );
}
