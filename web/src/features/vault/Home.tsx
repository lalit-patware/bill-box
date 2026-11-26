import { useTranslation } from 'react-i18next';

import { brand } from '../../config/brand';
import { toggleLanguage } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { AddSheet } from '../capture/AddSheet';
import { useCapture } from '../capture/useCapture';
import { type BillRow, useRecentBills } from './useRecentBills';

const KIND_ICON: Record<string, string> = {
  retail_fashion: '👕',
  electronics: '📱',
  recurring_milk: '🥛',
  laundry: '🧺',
  textile_kaccha: '🧵',
  vendor_credit: '🛒',
  medical_consult: '🩺',
  hospital: '🏥',
};

const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function Home() {
  const { t } = useTranslation();
  const capture = useCapture();
  const { bills, loading, error } = useRecentBills(capture.lastRun);

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 pt-4 pb-32">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{brand.name}</h1>
        <div className="flex gap-3 text-sm text-slate-500">
          <button className="min-h-11" onClick={toggleLanguage}>
            {t('language')}
          </button>
          <button className="min-h-11" onClick={() => void supabase.auth.signOut()}>
            {t('signOut')}
          </button>
        </div>
      </header>

      {!capture.online && <Banner tone="amber">{t('offline')}</Banner>}
      {capture.queued > 0 && <Banner tone="slate">{t('queued', { count: capture.queued })}</Banner>}
      {capture.skipped.length > 0 && (
        <Banner tone="red">{t('skipped', { names: capture.skipped.join(', ') })}</Banner>
      )}

      <h2 className="mt-2 mb-2 text-sm font-medium text-slate-500">{t('recent')}</h2>
      {loading && bills.length === 0 && (
        <div className="flex justify-center py-12">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      )}
      {!loading && error && capture.online && <Banner tone="red">{t('loadError')}</Banner>}
      {!loading && !error && bills.length === 0 && (
        <p className="py-12 text-center text-slate-500">{t('empty')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {bills.map((b) => (
          <BillItem key={b.id} bill={b} />
        ))}
      </ul>

      {capture.blurryFile && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/30">
          <div className="w-full rounded-t-2xl bg-white p-5 pb-8">
            <p className="mb-4 text-lg">{t('blurry')}</p>
            <div className="flex gap-3">
              <button
                onClick={capture.dismissBlurry}
                className="min-h-12 flex-1 rounded-xl bg-brand font-medium text-white"
              >
                {t('retake')}
              </button>
              <button
                onClick={() =>
                  void capture.add([capture.blurryFile!], 'camera', { skipBlurCheck: true })
                }
                className="min-h-12 flex-1 rounded-xl border border-slate-300 font-medium"
              >
                {t('useAnyway')}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddSheet busy={capture.busy} onFiles={(files, source) => void capture.add(files, source)} />
    </main>
  );
}

function BillItem({ bill }: { bill: BillRow }) {
  const { t } = useTranslation();
  const icon = KIND_ICON[bill.bill_kind ?? ''] ?? '🧾';
  const title =
    bill.status === 'done'
      ? (bill.vendor_name ?? (bill.ai_pending ? t('savedPending') : '—'))
      : bill.status === 'failed'
        ? t('failed')
        : t('processing');
  return (
    <li className="flex min-h-16 items-center gap-3 py-3">
      <span className="text-2xl" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate font-medium ${bill.status === 'failed' ? 'text-red-600' : ''}`}>{title}</p>
        <p className="text-sm text-slate-500">
          {fmtDate(bill.bill_date ?? bill.created_at)}
          {bill.ai_pending && (
            <span className="ml-2 rounded bg-sky-100 px-1.5 text-sky-800">{t('detailsSoon')}</span>
          )}
          {bill.needs_fix && !bill.ai_pending && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 text-amber-800">Fix</span>
          )}
        </p>
      </div>
      {bill.status === 'done' && bill.total != null && (
        <span className="font-semibold tabular-nums">{inr.format(bill.total)}</span>
      )}
      {(bill.status === 'processing' || bill.status === 'uploading') && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      )}
    </li>
  );
}

function Banner({ tone, children }: { tone: 'amber' | 'slate' | 'red'; children: React.ReactNode }) {
  const cls = {
    amber: 'bg-amber-50 text-amber-900',
    slate: 'bg-slate-100 text-slate-700',
    red: 'bg-red-50 text-red-800',
  }[tone];
  return <p className={`mb-3 rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</p>;
}
