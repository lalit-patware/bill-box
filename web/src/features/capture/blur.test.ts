import { describe, expect, it } from 'vitest';

import { BLUR_THRESHOLD, laplacianVariance, toGray } from './blur';
import { fitWithin } from './preprocess';

function image(w: number, h: number, f: (x: number, y: number) => number): Float32Array {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = f(x, y);
  return g;
}

describe('laplacianVariance', () => {
  it('is high for sharp text-like stripes and ~0 for a smooth gradient', () => {
    const sharp = image(64, 64, (x) => (Math.floor(x / 2) % 2 ? 255 : 0));
    const smooth = image(64, 64, (x) => x * 2);
    expect(laplacianVariance(sharp, 64, 64)).toBeGreaterThan(BLUR_THRESHOLD * 10);
    expect(laplacianVariance(smooth, 64, 64)).toBeLessThan(1);
  });

  it('drops when the same image is blurred', () => {
    const sharp = image(64, 64, (x, y) => ((x + y) % 6 < 3 ? 255 : 0));
    const blurred = new Float32Array(sharp.length);
    for (let y = 1; y < 63; y++)
      for (let x = 1; x < 63; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += sharp[(y + dy) * 64 + x + dx]!;
        blurred[y * 64 + x] = s / 9;
      }
    expect(laplacianVariance(blurred, 64, 64)).toBeLessThan(laplacianVariance(sharp, 64, 64) / 2);
  });

  it('handles tiny images', () => {
    expect(laplacianVariance(new Float32Array(4), 2, 2)).toBe(0);
  });
});

describe('toGray', () => {
  it('uses luma weights', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const g = toGray(rgba, 2, 1);
    expect(g[0]).toBeCloseTo(76.2, 1);
    expect(g[1]).toBeCloseTo(149.7, 1);
  });
});

describe('fitWithin', () => {
  it('keeps small images and scales the long edge to 1200', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 900, height: 1200 });
    expect(fitWithin(4000, 1000)).toEqual({ width: 1200, height: 300 });
  });
});
