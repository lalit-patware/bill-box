/**
 * Perceptual "difference hash": 64 bits describing the image's brightness gradients.
 * The same bill photographed or shared twice gives hashes a few bits apart;
 * different bills differ by ~20+ bits.
 */
export const DUPLICATE_MAX_DISTANCE = 6;
const W = 9;
const H = 8;

/** gray: 9×8 grayscale values, row-major. Returns 16 hex chars. */
export function dhashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== W * H) throw new Error(`expected ${W * H} pixels`);
  let bits = 0n;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits = (bits << 1n) | (gray[y * W + x]! > gray[y * W + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let v = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (v) {
    n += Number(v & 1n);
    v >>= 1n;
  }
  return n;
}

/** Browser-only: hash an already-decoded image. */
export function dhash(image: ImageBitmap): string {
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(image, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const gray = new Float32Array(W * H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  return dhashFromGray(gray);
}

export interface KnownBill {
  id: string;
  image_hash: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  created_at: string;
}

export function findDuplicate(hash: string, known: KnownBill[]): KnownBill | null {
  let best: KnownBill | null = null;
  let bestDist = DUPLICATE_MAX_DISTANCE + 1;
  for (const k of known) {
    if (!k.image_hash) continue;
    const d = hamming(hash, k.image_hash);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  }
  return best;
}
