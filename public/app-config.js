/*
 * Car Logbook — runtime configuration
 * ===================================
 *
 * Google Drive backup is OFF until you paste an OAuth Client ID below.
 * While googleClientId is empty the app hides every Drive button and offers
 * the Android share sheet backup instead.
 *
 * Two ways to set it:
 *   1. Edit this file, commit and push. GitHub Actions redeploys in ~1 minute.
 *   2. Open the app, go to Settings, and paste the ID there. That is stored
 *      on the device only and overrides this file. Handy for trying it out
 *      without a deploy.
 *
 * Full setup walkthrough is in README.md under "Google Drive backup setup".
 */
window.CAR_LOGBOOK_CONFIG = {
  // Looks like: 1234567890-abcdefghijklmnop.apps.googleusercontent.com
  googleClientId: '',
};
