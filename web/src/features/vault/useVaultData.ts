import { useEffect, useState } from 'react';

import { isEmptyQuery, parseQuery } from '../../lib/searchQuery';
import { BUCKET, supabase } from '../../lib/supabase';
import { type ActionBill, type ActionItem, type ActionProduct, buildActionItems } from './actionItems';
import type { BillRow } from './useRecentBills';

/** Search via the search_bills() database function (row level security applies). */
export function useSearch(query: string) {
  const [results, setResults] = useState<BillRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const parsed = parseQuery(query);
    if (isEmptyQuery(parsed)) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.rpc('search_bills', {
        words: parsed.words,
        kinds: parsed.kinds,
        p_month: parsed.month,
        p_year: parsed.year,
        p_limit: 50,
      });
      if (!cancelled) {
        setResults((data as BillRow[] | null) ?? []);
        setSearching(false);
      }
    }, 300); // debounce typing
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return { results, searching };
}

/** Deadlines, fixes, duplicates and pending reads for the "Action needed" block. */
export function useActionItems(refreshKey: number): ActionItem[] {
  const [items, setItems] = useState<ActionItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [billsRes, productsRes] = await Promise.all([
          supabase
            .from('bills')
            .select('id,vendor_name,needs_fix,ai_pending,confirmed_at,duplicate_of,status')
            .eq('status', 'done')
            .is('confirmed_at', null)
            .or('needs_fix.eq.true,ai_pending.eq.true,duplicate_of.not.is.null')
            .limit(50),
          supabase
            .from('products')
            .select('bill_id,name,warranty_until,exchange_until,bills(vendor_name)')
            .or(`exchange_until.gte.${today},warranty_until.gte.${today}`)
            .limit(50),
        ]);
        type ProductRow = Omit<ActionProduct, 'vendor_name'> & {
          bills: { vendor_name: string | null } | null;
        };
        const products: ActionProduct[] = ((productsRes.data ?? []) as unknown as ProductRow[]).map((p) => ({
          bill_id: p.bill_id,
          name: p.name,
          warranty_until: p.warranty_until,
          exchange_until: p.exchange_until,
          vendor_name: p.bills?.vendor_name ?? null,
        }));
        if (!cancelled) {
          setItems(buildActionItems((billsRes.data ?? []) as ActionBill[], products, new Date()));
        }
      } catch {
        // Offline: no action block rather than an error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return items;
}

/** Short-lived signed URLs for page-1 thumbnails (private bucket). PDFs get an icon instead. */
export function useThumbnails(bills: BillRow[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = bills.map((b) => b.page_paths[0] ?? '').join('|');

  useEffect(() => {
    const paths = bills
      .map((b) => b.page_paths[0])
      .filter((p): p is string => Boolean(p) && !p!.endsWith('.pdf'));
    if (!paths.length) return;
    let cancelled = false;
    void supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 600)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const next: Record<string, string> = {};
        for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
        setUrls((u) => ({ ...u, ...next }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}
