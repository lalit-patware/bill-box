/**
 * Blur check: variance of the Laplacian on a grayscale image.
 * Sharp text has strong edges → high variance; a blurry photo → low variance.
 */

/** Below this, we suggest a retake. Tune on real bills (Phase 0 set). */
export const BLUR_THRESHOLD = 60;
const SAMPLE_WIDTH = 512;

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
  }
  return gray;
}

export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v =
        gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export interface BlurResult {
  score: number;
  blurry: boolean;
}

/** Browser-only: draws a downscaled copy to canvas and scores it. */
export async function checkBlur(image: ImageBitmap): Promise<BlurResult> {
  const scale = Math.min(1, SAMPLE_WIDTH / image.width);
  const w = Math.max(3, Math.round(image.width * scale));
  const h = Math.max(3, Math.round(image.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { score: Infinity, blurry: false };
  ctx.drawImage(image, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const score = laplacianVariance(toGray(data, w, h), w, h);
  return { score, blurry: score < BLUR_THRESHOLD };
}
