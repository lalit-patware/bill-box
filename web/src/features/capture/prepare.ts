/** Turn picked files into queue entries: preprocess, read codes, decide live vs batch. */
import type { QueuedBill, Source } from '../../lib/db';
import { dhash } from '../../lib/dhash';
import { checkBlur } from './blur';
import { buildHints, readCodes } from './codes';
import { decodeImage, isPdf, MAX_UPLOAD_BYTES, toUploadJpeg } from './preprocess';
import { BATCH_THRESHOLD } from './queue';

export type Prepared = Omit<QueuedBill, 'id' | 'createdAt' | 'attempts'>;

export interface PrepareOutcome {
  bills: Prepared[];
  blurry: boolean; // only checked for single camera shots
  skipped: string[]; // file names we could not use
}

export function decideMode(source: Source, imageCount: number): 'live' | 'batch' {
  return source !== 'camera' && imageCount > BATCH_THRESHOLD ? 'batch' : 'live';
}

/**
 * Camera → one bill. Gallery/share → one bill per file (most people import several bills).
 * PDFs → one bill each (pages inside the PDF).
 */
export async function prepareFiles(
  files: File[],
  source: Source,
  opts: { skipBlurCheck?: boolean } = {},
): Promise<PrepareOutcome> {
  const outcome: PrepareOutcome = { bills: [], blurry: false, skipped: [] };
  const images = files.filter((f) => f.type.startsWith('image/'));
  const mode = decideMode(source, images.length);

  for (const file of files) {
    if (isPdf(file)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        outcome.skipped.push(file.name);
        continue;
      }
      outcome.bills.push({ pages: [file], source: 'pdf', mode: 'live', hints: null });
      continue;
    }
    if (!file.type.startsWith('image/')) {
      outcome.skipped.push(file.name);
      continue;
    }
    try {
      const bitmap = await decodeImage(file);
      if (source === 'camera' && !opts.skipBlurCheck && (await checkBlur(bitmap)).blurry) {
        bitmap.close();
        return { bills: [], blurry: true, skipped: [] };
      }
      const hints = buildHints(await readCodes(bitmap, file));
      const imageHash = safeHash(bitmap);
      const jpeg = await toUploadJpeg(bitmap);
      bitmap.close();
      outcome.bills.push({ pages: [jpeg], source, mode, hints, imageHash });
    } catch {
      outcome.skipped.push(file.name); // HEIC on some browsers, corrupt files
    }
  }
  return outcome;
}

function safeHash(bitmap: ImageBitmap): string | null {
  try {
    return dhash(bitmap);
  } catch {
    return null; // hashing is a nice-to-have; never block saving a bill
  }
}
