import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';

import { db, type Source } from '../../lib/db';
import { prepareFiles } from './prepare';
import { enqueue, processQueue } from './queue';
import { supabaseDeps } from './supabaseDeps';

export interface CaptureState {
  busy: boolean;
  blurryFile: File | null;
  skipped: string[];
  lastRun: number;
}

/** Capture → queue → upload, plus resume on reconnect. */
export function useCapture() {
  const queued = useLiveQuery(() => db.queue.count(), [], 0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [state, setState] = useState<CaptureState>({
    busy: false,
    blurryFile: null,
    skipped: [],
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

  const add = useCallback(
    async (files: File[], source: Source, opts: { skipBlurCheck?: boolean } = {}) => {
      if (!files.length) return;
      setState((s) => ({ ...s, busy: true, skipped: [] }));
      try {
        const out = await prepareFiles(files, source, opts);
        if (out.blurry) {
          setState((s) => ({ ...s, blurryFile: files[0] ?? null }));
          return;
        }
        if (out.bills.length) await enqueue(out.bills);
        setState((s) => ({ ...s, skipped: out.skipped, blurryFile: null }));
        await flush();
      } finally {
        setState((s) => ({ ...s, busy: false }));
      }
    },
    [flush],
  );

  const dismissBlurry = useCallback(() => setState((s) => ({ ...s, blurryFile: null })), []);

  return { ...state, queued, online, add, dismissBlurry, flush };
}
