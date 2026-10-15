# Car Logbook

A paper logbook for business trips, on your phone. Photograph the odometer as
you set off, photograph it again when you arrive, and type what the trip was
for. The app reads the kilometres off each photo, works out the distance and
throws the photos away. At tax time, export the financial year as a
spreadsheet for your accountant.

Installs to the Android home screen as a PWA and works with no signal.

- **Trips:** start reading, end reading, distance, date and times, and the
  purpose, which the ATO requires for every business trip.
- **No photos kept:** each photo is read for its digits and then discarded.
- **Financial year totals:** 1 July to 30 June, the Australian year.
- **CSV export:** one file per financial year for your accountant.
- **Backup file:** one small JSON file of every trip, saved through the
  Android share sheet (to Drive, email or anywhere else) and restored from the
  file picker. The home screen nudges you when a backup is due.

---

## Running it locally

```bash
npm install
npm run dev
```

The dev server prints a local address and a network address. Open the local one
in a desktop browser, or the network one on your phone if it is on the same
Wi-Fi. The app lives under the `/car-logbook/` path in development too, matching
production, so the URL is `http://localhost:5173/car-logbook/`.

Other commands:

```bash
npm run build
```

Builds into `dist/`.

```bash
npm run preview
```

Serves the built output, which is the honest way to test the service worker,
offline behaviour and the install prompt.

```bash
npm run icons
```

Regenerates the PWA icons from `scripts/icon.svg`. The PNGs are committed, so
neither CI nor a normal build needs this.

### Testing the camera

The capture flow uses a file input with `capture="environment"`, which opens the
rear camera on Android. On a desktop browser the same control opens a file
picker, so you can feed it a photo of an odometer to try the flow.

### A note on reading the digits

Text recognition runs through Tesseract.js, loaded from a CDN the first time you
use it and cached by the service worker afterwards. So the very first trip needs
a connection; after that it works offline. If the app misreads a number, or
cannot read it at all, the reading field is right there to type into. It never
blocks saving a trip.

---

## Publishing it the first time

Needs the GitHub CLI. If `gh --version` fails, install it:

```bash
winget install --id GitHub.cli -e
```

Close and reopen the terminal afterwards so `gh` lands on your PATH, then sign
in. This opens a browser and cannot be scripted:

```bash
gh auth login
```

Choose GitHub.com, HTTPS, and authenticate in the browser. Confirm with:

```bash
gh auth status
```

Then, from the project folder, create the repository and push:

```bash
gh repo create car-logbook --public --source=. --remote=origin --push
```

Turn on Pages with GitHub Actions as the source:

```bash
gh api -X POST "repos/{owner}/car-logbook/pages" -f build_type=workflow
```

Watch the first deploy:

```bash
gh run watch
```

When it finishes, the site is at
`https://<your-github-username>.github.io/car-logbook/`. The first deploy can
take a couple of minutes longer than later ones while Pages provisions.

## How deploying works

Every push to `main` triggers `.github/workflows/deploy.yml`, which installs
dependencies, runs `npm run build`, and publishes `dist/` to GitHub Pages using
the official `actions/deploy-pages` flow. There is no `gh-pages` branch; the
artifact goes straight from the build job to Pages.

Pages must be set to build from GitHub Actions rather than from a branch. That
is a one-off setting, done either in **Settings → Pages → Source → GitHub
Actions**, or with the API:

```bash
gh api -X POST "repos/{owner}/car-logbook/pages" -f build_type=workflow
```

The site is served from a subdirectory, so `vite.config.js` sets
`base: '/car-logbook/'`. If you ever rename the repository, change that value to
match or every asset will 404.

You can watch a run with:

```bash
gh run watch
```

The live URL is `https://<your-github-username>.github.io/car-logbook/`.

### Installing it on your phone

Open that URL in Chrome on Android, then use the browser menu and choose **Add
to Home screen** (Chrome may offer an install prompt by itself). It then runs
full screen with no browser chrome, and works with the phone in flight mode.

---

## How the data is stored

Everything lives in IndexedDB on the phone:

| Store   | Holds                                            |
| ------- | ------------------------------------------------ |
| `trips` | One record per trip: start and end readings, times and purpose |
| `meta`  | The time of the last backup                      |

The app asks the browser for persistent storage so Android will not evict the
database when space runs low. That is not a backup, though: if the phone is
lost or reset, the backup file is your copy.

A backup is a single JSON file holding every trip. Backups made by the first
version of the app (with photos) restore too; the photos are ignored.

## Project layout

```
src/
  main.js            app shell and hash router
  styles.css         the whole stylesheet
  lib/
    actions.js       the start-trip and end-trip flows
    backup.js        backup file build, check, restore and reminder
    dates.js         DD/MM/YYYY and the 1 July financial year
    db.js            IndexedDB
    export.js        CSV and the share sheet
    logbook.js       starting, ending and editing trips in storage
    ocr.js           Tesseract, digits only
    photo.js         opening the camera
    trip.js          validation rules and totals
    ui.js            element builder, toasts, modal, Back button handling
  views/
    capture.js       photo, confirm the reading, then the purpose
    home.js          trip in progress, totals, backup reminder
    settings.js      export, backup, restore, erase
    trips.js         trip list and the edit sheet
tests/               Vitest tests for the rules, backup, CSV and storage
public/
  icons/             generated PWA icons
```

Run the tests with:

```bash
npm test
```

## Caveats

The figures this app produces are a record-keeping aid, not tax advice. Check
the current ATO logbook rules before relying on them for a return.
