/**
 * Opening the camera.
 *
 * A plain file input with `capture="environment"` opens the rear camera
 * straight into the system camera app on Android. That is more reliable than
 * getUserMedia: no permission prompt of our own, the phone's real camera
 * processing, and no live stream left running if the app is backgrounded.
 *
 * The photo is only ever read for its digits. It is never stored.
 */

/**
 * Opens the rear camera and resolves with the chosen File, or null if the
 * camera was closed without a photo.
 *
 * Cancelling is reported by the input's `cancel` event. Older browsers
 * without it simply leave this pending; the capture screen still offers its
 * own Open camera and Cancel buttons, so nothing is stuck.
 */
export function captureOdometerPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    const finish = (value) => {
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => finish(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });

    input.click();
  });
}
