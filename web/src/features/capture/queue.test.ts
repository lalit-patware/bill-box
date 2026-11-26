import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api';
import { db } from '../../lib/db';
import { decideMode } from './prepare';
import { enqueue, isRetryable, MAX_ATTEMPTS, pagePaths, processQueue, type QueueDeps } from './queue';

const HH = 'hh-1';
const jpg = () => new Blob(['x'], { type: 'image/jpeg' });
const pdf = () => new Blob(['%PDF'], { type: 'application/pdf' });

function deps(over: Partial<QueueDeps> = {}): QueueDeps & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    householdId: async () => HH,
    userId: async () => 'user-1',
    insertBill: async (row) => void log.push(`insert:${row.id}:${row.status}`),
    uploadPage: async (path) => void log.push(`upload:${path}`),
    markProcessing: async (id, paths) => void log.push(`processing:${id}:${paths.length}`),
    extract: async (id) => void log.push(`extract:${id}`),
    batch: async (ids) => void log.push(`batch:${ids.length}`),
    isOnline: () => true,
    ...over,
  };
}

beforeEach(async () => {
  await db.queue.clear();
});

describe('pagePaths', () => {
  it('keeps pages inside the household folder with the right extension', () => {
    expect(pagePaths(HH, { id: 'b1', pages: [jpg(), pdf()] })).toEqual([`${HH}/b1/1.jpg`, `${HH}/b1/2.pdf`]);
  });
});

describe('decideMode', () => {
  it('uses batch only for bulk gallery/share imports', () => {
    expect(decideMode('camera', 10)).toBe('live');
    expect(decideMode('gallery', 3)).toBe('live');
    expect(decideMode('gallery', 4)).toBe('batch');
    expect(decideMode('share', 5)).toBe('batch');
  });
});

describe('processQueue', () => {
  it('uploads then extracts live bills and clears the queue', async () => {
    const [id] = await enqueue([{ pages: [jpg()], source: 'camera', mode: 'live', hints: null }]);
    const d = deps();
    const res = await processQueue(d);
    expect(res.done).toEqual([id]);
    expect(d.log).toEqual([`insert:${id}:uploading`, `upload:${HH}/${id}/1.jpg`, `processing:${id}:1`, `extract:${id}`]);
    expect(await db.queue.count()).toBe(0);
  });

  it('sends bulk imports as one batch', async () => {
    const ids = await enqueue(
      Array.from({ length: 5 }, () => ({ pages: [jpg()], source: 'gallery' as const, mode: 'batch' as const, hints: null })),
    );
    const d = deps();
    const res = await processQueue(d);
    expect(res.done.sort()).toEqual([...ids].sort());
    expect(d.log.filter((l) => l.startsWith('batch'))).toEqual(['batch:5']);
    expect(d.log.some((l) => l.startsWith('extract'))).toBe(false);
  });

  it('keeps everything queued while offline', async () => {
    await enqueue([{ pages: [jpg()], source: 'camera', mode: 'live', hints: null }]);
    const d = deps({ isOnline: () => false });
    const res = await processQueue(d);
    expect(res.pending).toHaveLength(1);
    expect(d.log).toEqual([]);
    expect(await db.queue.count()).toBe(1);
  });

  it('retries network errors without re-uploading, then succeeds', async () => {
    const [id] = await enqueue([{ pages: [jpg()], source: 'camera', mode: 'live', hints: null }]);
    const extract = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(undefined);
    const d = deps({ extract });
    expect((await processQueue(d)).pending).toEqual([id]);
    expect((await db.queue.get(id!))?.uploaded).toBe(true);

    const res = await processQueue(d);
    expect(res.done).toEqual([id]);
    expect(d.log.filter((l) => l.startsWith('upload'))).toHaveLength(1);
  });

  it('drops a bill the server could not read (502) instead of retrying forever', async () => {
    const [id] = await enqueue([{ pages: [jpg()], source: 'camera', mode: 'live', hints: null }]);
    const res = await processQueue(deps({ extract: async () => Promise.reject(new ApiError(502, 'bad')) }));
    expect(res.failed).toEqual([id]);
    expect(await db.queue.count()).toBe(0);
  });

  it('gives up after MAX_ATTEMPTS', async () => {
    await enqueue([{ pages: [jpg()], source: 'camera', mode: 'live', hints: null }]);
    const d = deps({ extract: async () => Promise.reject(new TypeError('offline')) });
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) expect((await processQueue(d)).pending).toHaveLength(1);
    expect((await processQueue(d)).failed).toHaveLength(1);
  });
});

describe('isRetryable', () => {
  it('retries network + 5xx, not 4xx or 502', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(new ApiError(503, ''))).toBe(true);
    expect(isRetryable(new ApiError(502, ''))).toBe(false);
    expect(isRetryable(new ApiError(404, ''))).toBe(false);
  });
});
