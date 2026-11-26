import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';

import { db, type Source } from '../../lib/db';
import { findDuplicate, type KnownBill } from '../../lib/dhash';
import { supabase } from '../../lib/supabase';
import { type Prepared, prepareFiles } from './prepare';
import { enqueue, processQueue } from './queue';
import { supabaseDeps } from './supabaseDeps';

export interface DuplicatePrompt {
  bill: Prepared;
  match: KnownBill;
}

export interface CaptureState {
  busy: boolean;
  blurryFile: File | null;
  duplicate: DuplicatePrompt | null;
  skipped: string[];
  duplicatesSkipped: number;
  lastRun: number;
}

/** Recent page hashes for duplicate checks. Offline → no check (never block saving). */
async function knownHashes(): Promise<KnownBill[]> {
  try {
    const { data, error } = await supabase
      .from('bills')
      .select('id,image_hash,vendor_name,bill_date,created_at')
      .not('image_hash', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000);
    return error || !data ? [] : (data as KnownBill[]);
  } catch {
    return [];
  }
}

/** Capture → duplicate check → queue → upload, plus resume on reconnect. */
export function useCapture() {
  const queued = useLiveQuery(() => db.queue.count(), [], 0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [state, setState] = useState<CaptureState>({
    busy: false,
    blurryFile: null,
    duplicate: null,
    skipped: [],
    duplicatesSkipped: 0,
    lastRun: 0,
  });

  const flush = useCallback(async () => {
    await processQueue(supabaseDeps);
    setState((s) => ({ ...s, lastRun: Date.now() }));
  }, []);

  useEffect(() => {
    void flush();
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [flush]);

  const save = useCallback(
    async (bills: Prepared[]) => {
      if (bills.length) await enqueue(bills);
      await flush();
    },
    [flush],
  );

  const add = useCallback(
    async (files: File[], source: Source, opts: { skipBlurCheck?: boolean } = {}) => {
      if (!files.length) return;
      setState((s) => ({ ...s, busy: true, skipped: [], duplicatesSkipped: 0 }));
      try {
        const out = await prepareFiles(files, source, opts);
        if (out.blurry) {
          setState((s) => ({ ...s, blurryFile: files[0] ?? null }));
          return;
        }
        const known = out.bills.some((b) => b.imageHash) ? await knownHashes() : [];
        const fresh: Prepared[] = [];
        let dupes = 0;
        for (const bill of out.bills) {
          const match = bill.imageHash ? findDuplicate(bill.imageHash, known) : null;
          if (!match) fresh.push(bill);
          else if (out.bills.length === 1) {
            // Single photo: ask. Bulk import: skip quietly and report the count.
            setState((s) => ({ ...s, blurryFile: null, duplicate: { bill, match } }));
            return;
          } else dupes++;
        }
        setState((s) => ({ ...s, skipped: out.skipped, duplicatesSkipped: dupes, blurryFile: null }));
        await save(fresh);
      } finally {
        setState((s) => ({ ...s, busy: false }));
      }
    },
    [save],
  );

  const saveDuplicateAnyway = useCallback(async () => {
    const dup = state.duplicate;
    setState((s) => ({ ...s, duplicate: null }));
    if (dup) await save([dup.bill]);
  }, [state.duplicate, save]);

  const dismissDuplicate = useCallback(() => setState((s) => ({ ...s, duplicate: null })), []);
  const dismissBlurry = useCallback(() => setState((s) => ({ ...s, blurryFile: null })), []);

  return {
    ...state,
    queued,
    online,
    add,
    flush,
    dismissBlurry,
    saveDuplicateAnyway,
    dismissDuplicate,
  };
}
