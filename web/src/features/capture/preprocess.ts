/** Resize + recompress photos on the phone before upload (fewer tokens, faster upload). */

export const MAX_LONG_EDGE = 1200;
export const JPEG_QUALITY = 0.8;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function fitWithin(
  width: number,
  height: number,
  maxLongEdge = MAX_LONG_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function isPdf(file: Blob): boolean {
  return file.type === 'application/pdf';
}

/** Decodes with EXIF orientation applied (so sideways phone photos come out upright). */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

export async function toUploadJpeg(image: ImageBitmap): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}
