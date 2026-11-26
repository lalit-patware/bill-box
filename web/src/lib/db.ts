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

export const db = new Dexie('billvault') as Dexie & {
  queue: EntityTable<QueuedBill, 'id'>;
  shared: EntityTable<SharedFile, 'id'>;
};

db.version(1).stores({
  queue: 'id, createdAt',
  shared: '++id, receivedAt',
});
