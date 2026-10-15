/**
 * Entry point: a three-tab shell with a hash router.
 *
 * Hash routing rather than history routing because the app is served from a
 * GitHub Pages subpath and must keep working when opened offline from the
 * home screen, where there is no server to resolve a deep path.
 */
import './styles.css';
import { registerSW } from 'virtual:pwa-register';

import { renderHome } from './views/home.js';
import { renderTrips } from './views/trips.js';
import { renderSettings } from './views/settings.js';
import { startTripFlow } from './lib/actions.js';
import { requestPersistentStorage } from './lib/db.js';
import { h, clear, icon, spinner, toast } from './lib/ui.js';

const ROUTES = {
  home: { label: 'Home', icon: 'home', render: renderHome },
  trips: { label: 'Trips', icon: 'list', render: renderTrips },
  settings: { label: 'Settings', icon: 'settings', render: renderSettings },
};

const DEFAULT_ROUTE = 'home';

const root = document.getElementById('app');
let currentRoute = DEFAULT_ROUTE;
let rendering = false;
let pendingRender = false;

/* --------------------------------------------------------------- router -- */

function routeFromHash() {
  const name = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[name] ? name : DEFAULT_ROUTE;
}

function navigate(name) {
  const target = ROUTES[name] ? name : DEFAULT_ROUTE;
  if (routeFromHash() === target) {
    currentRoute = target;
    void render();
    return;
  }
  location.hash = `#/${target}`;
}

async function refresh() {
  await render();
}

/* --------------------------------------------------------------- render -- */

async function render() {
  // Coalesce overlapping renders; the last request wins.
  if (rendering) {
    pendingRender = true;
    return;
  }
  rendering = true;

  const route = ROUTES[currentRoute] || ROUTES[DEFAULT_ROUTE];

  try {
    const main = document.getElementById('main') || buildShell();
    const scroller = document.getElementById('scroll');

    const view = await route.render({ navigate, refresh });

    clear(main);
    main.appendChild(view);
    if (scroller) scroller.scrollTop = 0;

    updateTabs();
    document.title =
      currentRoute === DEFAULT_ROUTE ? 'Car Logbook' : `${route.label} · Car Logbook`;
  } catch (err) {
    console.error('[app] render failed', err);
    renderFatal(err);
  } finally {
    rendering = false;
    if (pendingRender) {
      pendingRender = false;
      await render();
    }
  }
}

function buildShell() {
  clear(root);

  const scroller = h('div', { class: 'shell__scroll', id: 'scroll' });
  const main = h('main', { class: 'shell__main', id: 'main' });
  scroller.appendChild(main);

  const nav = h(
    'nav',
    { class: 'tabbar', id: 'tabbar', 'aria-label': 'Main' },
    ...Object.entries(ROUTES).map(([name, route]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'tab',
          dataset: { route: name },
          onclick: () => navigate(name),
        },
        icon(route.icon),
        h('span', { class: 'tab__label' }, route.label),
      ),
    ),
  );

  root.appendChild(scroller);
  root.appendChild(nav);
  return main;
}

function updateTabs() {
  const nav = document.getElementById('tabbar');
  if (!nav) return;
  for (const tab of nav.querySelectorAll('.tab')) {
    const active = tab.dataset.route === currentRoute;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-current', active ? 'page' : 'false');
  }
}

function renderFatal(err) {
  const main = document.getElementById('main');
  if (!main) return;
  clear(main);
  main.appendChild(
    h(
      'div',
      { class: 'empty' },
      h('p', { class: 'empty__title' }, 'Something went wrong'),
      h('p', { class: 'empty__text' }, String(err?.message || err)),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          onclick: () => location.reload(),
        },
        'Reload',
      ),
    ),
  );
}

/* ----------------------------------------------------- service worker -- */

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  registerSW({
    immediate: true,
    onOfflineReady() {
      toast('Ready to work offline.', { type: 'success' });
    },
    onRegisterError(err) {
      console.warn('[pwa] registration failed', err);
    },
  });
}

/* ---------------------------------------------------------------- boot -- */

async function boot() {
  root.classList.add('app--loading');
  clear(root);
  root.appendChild(h('div', { class: 'boot' }, spinner('Loading your logbook')));

  // Home-screen shortcuts arrive as ?view=trips or ?action=start-trip.
  const params = new URLSearchParams(location.search);
  const shortcutView = params.get('view');
  const startTripNow = params.get('action') === 'start-trip';
  if (params.size) {
    const route = ROUTES[shortcutView] ? shortcutView : routeFromHash();
    history.replaceState(null, '', `${location.pathname}#/${route}`);
  }

  currentRoute = routeFromHash();
  if (!location.hash) location.replace(`#/${currentRoute}`);

  root.classList.remove('app--loading');
  await render();

  // Ask Android not to evict the database under storage pressure.
  void requestPersistentStorage();

  setupServiceWorker();

  window.addEventListener('hashchange', () => {
    currentRoute = routeFromHash();
    void render();
  });

  if (startTripNow && (await startTripFlow())) await render();
}

boot().catch((err) => {
  console.error('[app] boot failed', err);
  renderFatal(err);
});
