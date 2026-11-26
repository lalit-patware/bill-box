import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { supabase } from '../../lib/supabase';
import { inr, KIND_ICON } from '../vault/format';
import { Banner, Sheet, SheetButtons, Spinner } from '../vault/ui';
import { type LedgerRow, monthLabel, upiLink, type VendorRow } from './ledger';

const CATEGORY_ICON: Record<string, string> = {
  milk: KIND_ICON.recurring_milk!,
  laundry: KIND_ICON.laundry!,
  kirana: KIND_ICON.vendor_credit!,
};

/** Monthly dues per recurring vendor (milkman, dhobi, kirana) with UPI pay + mark paid. */
export function Vendors() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<VendorRow[] | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [error, setError] = useState(false);
  const [paying, setPaying] = useState<{ row: LedgerRow; vendor: VendorRow } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [v, l] = await Promise.all([
      supabase.from('vendors').select('id,name,phone,upi_vpa,category,is_recurring').eq('is_recurring', true).order('name'),
      supabase.from('vendor_ledger').select('*').order('month', { ascending: false }).limit(300),
    ]);
    if (v.error || l.error) setError(true);
    setVendors((v.data ?? []) as VendorRow[]);
    setLedger((l.data ?? []) as LedgerRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markPaid = async (row: LedgerRow) => {
    setBusy(true);
    const { error: e } = await supabase
      .from('vendor_ledger')
      .update({ amount_paid: row.amount_due, paid_on: new Date().toISOString().slice(0, 10) })
      .eq('id', row.id);
    setBusy(false);
    setPaying(null);
    if (e) setError(true);
    await load();
  };

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 pt-3 pb-16">
      <header className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate('/')} className="-ml-2 h-11 w-11 rounded-full text-2xl active:bg-slate-100" aria-label={t('back')}>
          ‹
        </button>
        <h1 className="text-lg font-semibold">{t('vendorsTitle')}</h1>
      </header>
      {error && <Banner tone="red">{t('loadError')}</Banner>}
      {vendors === null && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}
      {vendors?.length === 0 && <p className="py-16 text-center text-slate-500">{t('vendorsEmpty')}</p>}

      <ul className="flex flex-col gap-3">
        {vendors?.map((v) => {
          const rows = ledger.filter((l) => l.vendor_id === v.id);
          const open = rows.filter((r) => Number(r.amount_due) - Number(r.amount_paid) > 0);
          const balance = open.reduce((s, r) => s + Number(r.amount_due) - Number(r.amount_paid), 0);
          return (
            <li key={v.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">
                  <span aria-hidden>{CATEGORY_ICON[v.category ?? ''] ?? '🏪'}</span> {v.name}
                </p>
                {balance > 0 ? (
                  <span className="font-semibold text-amber-800">{t('dueAmount', { amount: inr(balance) })}</span>
                ) : (
                  <span className="text-sm text-emerald-700">✓ {t('allPaid')}</span>
                )}
              </div>
              <ul className="mt-2 divide-y divide-slate-100">
                {rows.slice(0, 6).map((r) => {
                  const left = Number(r.amount_due) - Number(r.amount_paid);
                  return (
                    <li key={r.id} className="flex min-h-12 items-center justify-between gap-2 text-sm">
                      <span className="text-slate-600">{monthLabel(r.month)}</span>
                      <span className="tabular-nums">{inr(Number(r.amount_due))}</span>
                      {left > 0 ? (
                        <button
                          onClick={() => setPaying({ row: r, vendor: v })}
                          className="min-h-11 rounded-full bg-brand px-4 font-medium text-white"
                        >
                          {t('pay')}
                        </button>
                      ) : (
                        <span className="min-w-16 text-right text-emerald-700">{t('paid')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {paying && (
        <Sheet onClose={() => setPaying(null)}>
          <p className="mb-1 text-lg">
            {paying.vendor.name} · {monthLabel(paying.row.month)}
          </p>
          <p className="mb-4 text-2xl font-semibold">
            {inr(Number(paying.row.amount_due) - Number(paying.row.amount_paid))}
          </p>
          {paying.vendor.upi_vpa ? (
            <a
              href={upiLink(
                paying.vendor.upi_vpa,
                paying.vendor.name,
                Number(paying.row.amount_due) - Number(paying.row.amount_paid),
                `${monthLabel(paying.row.month)} bill`,
              )}
              className="mb-3 flex min-h-12 items-center justify-center rounded-xl bg-brand font-medium text-white"
            >
              {t('payUpi')}
            </a>
          ) : (
            <p className="mb-3 text-sm text-slate-500">{t('noUpi')}</p>
          )}
          <SheetButtons
            primary={{ label: busy ? '…' : t('markPaid'), onClick: () => void markPaid(paying.row) }}
            secondary={{ label: t('cancel'), onClick: () => setPaying(null) }}
          />
        </Sheet>
      )}
    </main>
  );
}
