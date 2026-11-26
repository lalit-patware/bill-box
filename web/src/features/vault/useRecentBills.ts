import { useCallback, useEffect, useState } from 'react';

import { db } from '../../lib/db';
import { supabase } from '../../lib/supabase';

export interface BillRow {
  id: string;
  status: 'uploading' | 'processing' | 'done' | 'failed';
  bill_kind: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  total: number | null;
  needs_fix: boolean;
  ai_pending: boolean;
  confirmed_at: string | null;
  duplicate_of: string | null;
  page_paths: string[];
  created_at: string;
}

export const BILL_LIST_COLUMNS =
  'id,status,bill_kind,vendor_name,bill_date,total,needs_fix,ai_pending,confirmed_at,duplicate_of,page_paths,created_at';

const POLL_MS = 4000;
const CACHE_KEY = 'recent';

export function useRecentBills(refreshKey: number) {
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase
        .from('bills')
        .select(BILL_LIST_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(30);
      if (e || !data) throw e ?? new Error('no data');
      setBills(data as BillRow[]);
      setError(false);
      setFromCache(false);
      void db.cache.put({ key: CACHE_KEY, data, savedAt: Date.now() });
    } catch {
      // Offline or server hiccup: show the last list we saw.
      const cached = await db.cache.get(CACHE_KEY);
      if (cached) {
        setBills(cached.data as BillRow[]);
        setFromCache(true);
      } else setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Poll while a bill is still being read. "Details pending" (no AI) bills are re-read by
  // the server every 5 min, so they refresh on the next app open instead.
  const pending = bills.some((b) => b.status === 'processing' || b.status === 'uploading');
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [pending, load]);

  return { bills, loading, error, fromCache, reload: load };
}
