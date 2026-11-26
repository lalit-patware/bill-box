import { useCallback, useEffect, useState } from 'react';

import { cacheImage, db } from '../../lib/db';
import { BUCKET, supabase } from '../../lib/supabase';

export interface Validation {
  items_sum: number | null;
  total_mismatch: boolean;
  mismatch_amount: number | null;
  line_mismatches: number[];
  low_confidence_fields: string[];
}

export interface BillDetailRow {
  id: string;
  household_id: string;
  status: 'uploading' | 'processing' | 'done' | 'failed';
  bill_kind: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  bill_no: string | null;
  total: number | null;
  tax: number | null;
  is_handwritten: boolean | null;
  needs_fix: boolean;
  total_mismatch: boolean;
  ai_pending: boolean;
  confirmed_at: string | null;
  duplicate_of: string | null;
  page_paths: string[];
  validation: Validation | null;
  raw_extraction: {
    notes?: { value: string | null };
    milk_days?: { day: number; litres: number | null }[];
    piece_count?: { value: number | null };
    period_month?: { value: string | null };
  } | null;
  error: string | null;
  created_at: string;
}

export interface ItemRow {
  id: string;
  position: number;
  name: string;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number | null;
}

export interface ProductRow {
  id: string;
  name: string | null;
  serial_no: string | null;
  warranty_until: string | null;
  exchange_until: string | null;
}

export interface BillBundle {
  bill: BillDetailRow;
  items: ItemRow[];
  products: ProductRow[];
}

export type EditableField = 'vendor_name' | 'bill_date' | 'total' | 'bill_no';

export function useBill(id: string) {
  const [data, setData] = useState<BillBundle | null>(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    const cacheKey = `bill:${id}`;
    try {
      const [b, i, p] = await Promise.all([
        supabase.from('bills').select('*').eq('id', id).maybeSingle(),
        supabase.from('bill_items').select('*').eq('bill_id', id).order('position'),
        supabase.from('products').select('*').eq('bill_id', id),
      ]);
      if (b.error) throw b.error;
      if (!b.data) {
        setMissing(true);
        return;
      }
      const bundle: BillBundle = {
        bill: b.data as BillDetailRow,
        items: (i.data ?? []) as ItemRow[],
        products: (p.data ?? []) as ProductRow[],
      };
      setData(bundle);
      setOffline(false);
      void db.cache.put({ key: cacheKey, data: bundle, savedAt: Date.now() });
    } catch {
      const cached = await db.cache.get(cacheKey);
      if (cached) {
        setData(cached.data as BillBundle);
        setOffline(true);
      } else setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep refreshing while the server is still reading the bill.
  const reading = data?.bill.status === 'processing' || data?.bill.status === 'uploading';
  useEffect(() => {
    if (!reading) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [reading, load]);

  return { data, missing, offline, reload: load, setData };
}

/** Page images: signed URL online (and cached as a blob), cached blob offline. */
export function usePageImages(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join('|');

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const path of paths) {
        if (path.endsWith('.pdf')) continue;
        const cached = await db.images.get(path);
        if (cached) {
          const u = URL.createObjectURL(cached.blob);
          objectUrls.push(u);
          next[path] = u;
          continue;
        }
        try {
          const { data } = await supabase.storage.from(BUCKET).download(path);
          if (data) {
            void cacheImage(path, data);
            const u = URL.createObjectURL(data);
            objectUrls.push(u);
            next[path] = u;
          }
        } catch {
          // offline and not cached: show placeholder
        }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}

/** Validation after the user corrects one field. */
export function afterEdit(
  bill: Pick<BillDetailRow, 'validation' | 'total_mismatch'>,
  field: EditableField,
): { validation: Validation | null; needs_fix: boolean; total_mismatch: boolean } {
  const v = bill.validation;
  const low = (v?.low_confidence_fields ?? []).filter((f) => f !== field);
  const totalMismatch = field === 'total' ? false : bill.total_mismatch;
  return {
    validation: v ? { ...v, low_confidence_fields: low, total_mismatch: totalMismatch } : null,
    needs_fix: low.length > 0 || totalMismatch,
    total_mismatch: totalMismatch,
  };
}

export async function openPdf(path: string): Promise<void> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
}
