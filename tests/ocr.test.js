import { describe, expect, it } from 'vitest';
import { normaliseLuminance, pickReading } from '../src/lib/ocr.js';

describe('pickReading', () => {
  it('returns null when there are no digits', () => {
    expect(pickReading('')).toBeNull();
  });

  it('takes the longest run of digits with no hint', () => {
    expect(pickReading('123\n048210')).toBe(48210);
  });

  it('prefers the number just above the last reading', () => {
    // The trip meter (48230 would be 20 km on) beats a stray longer run.
    expect(pickReading('112345 48230', { near: 48210 })).toBe(48230);
  });

  it('falls back to the longest run when nothing is above the hint', () => {
    expect(pickReading('48100', { near: 48210 })).toBe(48100);
  });

  it('ignores runs too short to be an odometer', () => {
    expect(pickReading('12 7')).toBeNull();
  });
});

describe('normaliseLuminance', () => {
  it('stretches a dim photo to full contrast', () => {
    const out = normaliseLuminance(Uint8ClampedArray.from([200, 210, 220, 230, 100]));
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(255);
  });

  it('inverts a dark display so the digits come out dark on light', () => {
    // Mostly dark background with a few bright digit pixels.
    const grey = Uint8ClampedArray.from([10, 10, 10, 10, 10, 10, 240, 240]);
    const out = normaliseLuminance(grey);
    expect(out[0]).toBe(255);
    expect(out[6]).toBe(0);
  });

  it('leaves dark-on-light text the right way round', () => {
    const grey = Uint8ClampedArray.from([240, 240, 240, 240, 240, 240, 10, 10]);
    const out = normaliseLuminance(grey);
    expect(out[0]).toBe(255);
    expect(out[6]).toBe(0);
  });
});
