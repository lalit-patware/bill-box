import Dexie, { type EntityTable } from 'dexie';

import type { CodeHints } from '../features/capture/codes';

export type Source = 'camera' | 'gallery' | 'pdf' | 'share' | 'import';
export type Mode = 'live' | 'batch';

/** A bill waiting to be uploaded. Captures land here first so nothing is lost offline. */
export interface QueuedBill {
  id: string; // = bill id in Supabase
  pages: Blob[];
  source: Source;
  mode: Mode;
  hints: CodeHints | null;
  imageHash?: string | null; // perceptual hash of page 1 (duplicate detection)
  createdAt: number;
  attempts: number;
  lastError?: string;
  // Set once rows/pages exist server-side, so a retry resumes instead of duplicating.
  uploaded?: boolean;
}

/** Files received through the Web Share Target, picked up by the /share page. */
export interface SharedFile {
  id?: number;
  file: Blob;
  name: string;
  type: string;
  receivedAt: number;
}

/** Last-seen server data, so the vault opens offline. */
export interface CacheEntry {
  key: string; // 'recent' | `bill:${id}`
  data: unknown;
  savedAt: number;
}

/** Bill page images viewed once, kept for offline viewing. */
export interface CachedImage {
  path: string;
  blob: Blob;
  savedAt: number;
}

export const db = new Dexie('billvault') as Dexie & {
  queue: EntityTable<QueuedBill, 'id'>;
  shared: EntityTable<SharedFile, 'id'>;
  cache: EntityTable<CacheEntry, 'key'>;
  images: EntityTable<CachedImage, 'path'>;
};

db.version(1).stores({
  queue: 'id, createdAt',
  shared: '++id, receivedAt',
});
db.version(2).stores({
  queue: 'id, createdAt',
  shared: '++id, receivedAt',
  cache: 'key',
  images: 'path, savedAt',
});

export const MAX_CACHED_IMAGES = 60;

export async function cacheImage(path: string, blob: Blob): Promise<void> {
  await db.images.put({ path, blob, savedAt: Date.now() });
  const count = await db.images.count();
  if (count > MAX_CACHED_IMAGES) {
    const oldest = await db.images.orderBy('savedAt').limit(count - MAX_CACHED_IMAGES).primaryKeys();
    await db.images.bulkDelete(oldest);
  }
}
