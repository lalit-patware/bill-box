/**
 * Durable upload queue. Every capture is written to IndexedDB first, then:
 *   1. insert bill row (status=uploading)  2. upload pages to private storage
 *   3. mark status=processing              4. call the API (live, or batch for bulk)
 * Works offline: items stay queued and resume on the next `online` event.
 */
import { ApiError } from '../../lib/api';
import { db, type QueuedBill } from '../../lib/db';
import type { CodeHints } from './codes';

export interface QueueDeps {
  householdId(): Promise<string>;
  userId(): Promise<string>;
  insertBill(row: {
    id: string;
    household_id: string;
    created_by: string;
    status: 'uploading';
    source: QueuedBill['source'];
    hints: CodeHints | null;
  }): Promise<void>;
  uploadPage(path: string, page: Blob): Promise<void>;
  markProcessing(billId: string, pagePaths: string[]): Promise<void>;
  extract(billId: string): Promise<void>;
  batch(billIds: string[]): Promise<void>;
  isOnline(): boolean;
}

export const MAX_ATTEMPTS = 5;
export const BATCH_THRESHOLD = 3; // more than this many gallery images → Batch API

export function pageExt(page: Blob): string {
  return page.type === 'application/pdf' ? 'pdf' : 'jpg';
}

export function pagePaths(householdId: string, bill: Pick<QueuedBill, 'id' | 'pages'>): string[] {
  return bill.pages.map((p, i) => `${householdId}/${bill.id}/${i + 1}.${pageExt(p)}`);
}

/** Retry only on network trouble or transient server errors. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500 && err.status !== 502;
  return true; // fetch TypeError (offline), storage hiccups
}

let running: Promise<QueueRunResult> | null = null;

export interface QueueRunResult {
  done: string[];
  failed: string[];
  pending: string[];
}

export function processQueue(deps: QueueDeps): Promise<QueueRunResult> {
  running ??= run(deps).finally(() => {
    running = null;
  });
  return running;
}

async function upload(item: QueuedBill, deps: QueueDeps): Promise<void> {
  if (item.uploaded) return;
  const householdId = await deps.householdId();
  await deps.insertBill({
    id: item.id,
    household_id: householdId,
    created_by: await deps.userId(),
    status: 'uploading',
    source: item.source,
    hints: item.hints,
  });
  const paths = pagePaths(householdId, item);
  for (const [i, page] of item.pages.entries()) await deps.uploadPage(paths[i]!, page);
  await deps.markProcessing(item.id, paths);
  await db.queue.update(item.id, { uploaded: true });
  item.uploaded = true;
}

async function fail(item: QueuedBill, err: unknown, result: QueueRunResult): Promise<void> {
  const attempts = item.attempts + 1;
  if (isRetryable(err) && attempts < MAX_ATTEMPTS) {
    await db.queue.update(item.id, { attempts, lastError: String(err) });
    result.pending.push(item.id);
  } else {
    await db.queue.delete(item.id);
    result.failed.push(item.id);
  }
}

async function run(deps: QueueDeps): Promise<QueueRunResult> {
  const result: QueueRunResult = { done: [], failed: [], pending: [] };
  const items = await db.queue.orderBy('createdAt').toArray();
  if (!deps.isOnline()) {
    result.pending.push(...items.map((i) => i.id));
    return result;
  }

  const batchReady: QueuedBill[] = [];
  for (const item of items) {
    try {
      await upload(item, deps);
      if (item.mode === 'batch') {
        batchReady.push(item);
        continue;
      }
      await deps.extract(item.id);
      await db.queue.delete(item.id);
      result.done.push(item.id);
    } catch (err) {
      await fail(item, err, result);
    }
  }

  if (batchReady.length) {
    try {
      await deps.batch(batchReady.map((i) => i.id));
      await db.queue.bulkDelete(batchReady.map((i) => i.id));
      result.done.push(...batchReady.map((i) => i.id));
    } catch (err) {
      for (const item of batchReady) await fail(item, err, result);
    }
  }
  return result;
}

export async function enqueue(
  bills: Omit<QueuedBill, 'id' | 'createdAt' | 'attempts'>[],
): Promise<string[]> {
  const now = Date.now();
  const rows: QueuedBill[] = bills.map((b, i) => ({
    ...b,
    id: crypto.randomUUID(),
    createdAt: now + i,
    attempts: 0,
  }));
  await db.queue.bulkAdd(rows);
  return rows.map((r) => r.id);
}
