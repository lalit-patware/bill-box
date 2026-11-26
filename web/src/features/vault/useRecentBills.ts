import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../../lib/supabase';

export interface BillRow {
  id: string;
  status: 'uploading' | 'processing' | 'done' | 'failed';
  bill_kind: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  total: number | null;
  needs_fix: boolean;
  created_at: string;
}

const POLL_MS = 4000;

export function useRecentBills(refreshKey: number) {
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase
        .from('bills')
        .select('id,status,bill_kind,vendor_name,bill_date,total,needs_fix,created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      setError(Boolean(e));
      if (!e && data) setBills(data as BillRow[]);
    } catch {
      setError(true); // offline: keep showing the last list
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Poll while any bill is still being read (batch results can take a while).
  const pending = bills.some((b) => b.status === 'processing' || b.status === 'uploading');
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [pending, load]);

  return { bills, loading, error, reload: load };
}
