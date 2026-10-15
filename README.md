# Car Logbook

An offline-first vehicle logbook for Australian business-use records. Photograph
the odometer at the start and end of each trip, confirm the reading the app
reads off the photo, and record the purpose. Everything is stored on the phone
and works with no signal.

Installs to the Android home screen as a PWA.

- **Trips** — photo and odometer reading at each end, device clock for the time,
  purpose recorded per trip because the ATO requires a reason.
- **Logbook periods** — optional. Run a continuous period (the ATO asks for at
  least 12 weeks) to work out your business use percentage.
- **Financial year totals** — 1 July to 30 June, the Australian year.
- **Google Drive backup** — one JSON file holding every trip and photo, saved to
  a "Car Logbook Backups" folder, keeping the last 10.
- **CSV export** — one file per financial year for your accountant.

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

### A note on OCR

Text recognition runs through Tesseract.js, loaded from a CDN the first time you
use it and cached by the service worker afterwards. So the very first OCR run
needs a connection; after that it works offline. If recognition is unavailable
or wrong, the reading field is right there to type into. OCR never blocks saving
a trip.

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

## Google Drive backup setup

Drive backup is off until you supply an OAuth Client ID. Until then the app
hides every Drive button and offers a share-sheet backup instead, which saves
the same JSON file through Android's share sheet. Nothing is lost by leaving
Drive switched off.

The app asks for the `drive.file` scope and nothing else. That scope only grants
access to files the app itself created, so it cannot see the rest of your Drive.

### 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Click the project dropdown in the top bar, then **New project**.
3. Name it something like `car-logbook` and click **Create**.
4. Make sure the new project is selected before continuing.

### 2. Enable the Drive API

1. Go to **APIs & Services → Library**.
2. Search for **Google Drive API**.
3. Open it and click **Enable**.

### 3. Configure the consent screen

1. Go to **APIs & Services → OAuth consent screen** (newer consoles call this
   **Google Auth Platform → Branding**).
2. Choose **External** for the user type and click **Create**.
3. Fill in the required fields: app name, your email as the user support email,
   and your email again as the developer contact. Nothing else is needed.
4. On the **Scopes** step, click **Add or remove scopes**, filter for
   `drive.file`, and tick
   `https://www.googleapis.com/auth/drive.file`. Save and continue.
5. On the **Test users** step, add your own Google account.
6. Save.

**Worth knowing:** while the app sits in *Testing* status, Google expires the
grant after seven days, so you would have to reconnect weekly. `drive.file` is a
non-sensitive scope, so you can normally move the app to *In production* under
**Audience** or **Publishing status** without going through app verification,
and the grant then stops expiring. Do that if weekly reconnection would annoy
you.

### 4. Create the OAuth client ID

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Give it a name, such as `car-logbook web`.
5. Under **Authorised JavaScript origins**, click **Add URI** and add your Pages
   origin, with no path and no trailing slash:

   ```
   https://<your-github-username>.github.io
   ```

   Add the dev server too if you want Drive working locally:

   ```
   http://localhost:5173
   ```

6. Leave **Authorised redirect URIs** empty. The app uses the Google Identity
   Services token flow, which works off the origin and needs no redirect URI.
7. Click **Create** and copy the Client ID. It looks like
   `123456789012-abcdefghijklmnop.apps.googleusercontent.com`.

### 5. Give the Client ID to the app

Either way works, and the second needs no deploy.

**In the repository**, edit `public/app-config.js`:

```js
window.CAR_LOGBOOK_CONFIG = {
  googleClientId: '123456789012-abcdefghijklmnop.apps.googleusercontent.com',
};
```

Commit and push. The Action redeploys in about a minute and the Drive buttons
appear.

**Or on the device**, open the app, go to **Settings → Google Drive backup →
OAuth Client ID**, paste it in and save. That is stored on that device only and
overrides the file.

### 6. Connect

Open **Settings** and tap **Connect and back up**. Google asks you to pick an
account and approve access, then the first backup uploads. After that:

- A backup runs automatically when a trip is saved, as long as a valid token is
  held and you are online.
- When it cannot run, the home screen shows a **Backup needed** banner with a
  one-tap button.
- Only the ten most recent backups are kept; older ones are deleted.
- **Restore from Drive** lists the backups, and restoring replaces everything on
  the device with the chosen file.

---

## How the data is stored

Everything lives in IndexedDB on the device:

| Store     | Holds                                                     |
| --------- | --------------------------------------------------------- |
| `trips`   | One record per trip, with the start and end readings       |
| `periods` | Logbook periods                                            |
| `photos`  | Compressed odometer JPEGs, around 200 KB or less each      |
| `meta`    | Small bits of state such as the last backup time           |

Photos are downscaled and re-encoded on capture until they fit the size budget,
which keeps a few hundred trips comfortably within browser storage and keeps
backups a sensible size. The app asks the browser for persistent storage so
Android will not evict the database when space runs low.

A backup is a single JSON file holding the trips, the periods and every photo as
base64. The same file restores through either Drive or the file picker.

## Project layout

```
src/
  main.js            app shell and hash router
  styles.css         the whole stylesheet
  lib/
    actions.js       flows spanning capture, storage and backup
    backup.js        backup payload build, validate and restore
    config.js        Client ID resolution
    dates.js         DD/MM/YYYY and the 1 July financial year
    db.js            IndexedDB
    drive.js         Google Identity Services and the Drive REST calls
    export.js        CSV and Web Share
    logbook.js       validation rules and totals
    ocr.js           Tesseract, digits only
    photo.js         camera capture and compression
    ui.js            element builder, toasts, modal
  views/
    capture.js       the photo-then-confirm odometer screen
    home.js          status, totals, primary actions
    settings.js      backup, restore, export, stored data
    trips.js         trip list and the edit sheet
public/
  app-config.js      runtime config, edited after a build
  icons/             generated PWA icons
```

## Caveats

The figures this app produces are a record-keeping aid, not tax advice. Check
the current ATO logbook rules before relying on them for a return.
