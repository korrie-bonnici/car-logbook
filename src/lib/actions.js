/**
 * The two things you do in the car: start a trip and end one.
 * Views call these and then re-render.
 */
import { captureReading } from '../views/capture.js';
import { endTrip, loadState, startTrip } from './logbook.js';
import { formatKm, validateEnd, validateStart } from './trip.js';
import { toast } from './ui.js';

/** Returns true when a trip was started. */
export async function startTripFlow() {
  const { latestOdometer, openTrip } = await loadState();
  if (openTrip) {
    toast('A trip is already in progress. End it first.');
    return false;
  }

  const result = await captureReading({
    title: 'Start trip',
    hint: 'Photograph the odometer before you set off.',
    submitLabel: 'Start trip',
    near: latestOdometer,
    validate: (value) => validateStart(value, { latestOdometer }),
  });
  if (!result) return false;

  await startTrip({ odometer: result.odometer, at: result.at });
  toast('Trip started. Drive safely.', { type: 'success' });
  return true;
}

/** Returns true when the trip was saved. */
export async function endTripFlow(openTrip) {
  if (!openTrip) return false;
  const startOdometer = openTrip.start.odometer;

  const result = await captureReading({
    title: 'End trip',
    hint: 'Photograph the odometer now that you have arrived.',
    submitLabel: 'Save trip',
    near: startOdometer,
    startOdometer,
    validate: (value) => validateEnd(value, { startOdometer }),
  });
  if (!result) return false;

  await endTrip(openTrip.id, result);
  toast(`Trip saved. ${formatKm(result.odometer - startOdometer)} km recorded.`, {
    type: 'success',
  });
  return true;
}
