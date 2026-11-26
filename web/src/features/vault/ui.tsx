import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { fmtDate, inr, KIND_ICON } from './format';
import type { BillRow } from './useRecentBills';

export function Banner({ tone, children }: { tone: 'amber' | 'slate' | 'red' | 'sky'; children: ReactNode }) {
  const cls = {
    amber: 'bg-amber-50 text-amber-900',
    slate: 'bg-slate-100 text-slate-700',
    red: 'bg-red-50 text-red-800',
    sky: 'bg-sky-50 text-sky-900',
  }[tone];
  return <div className={`mb-3 rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6';
  return <span className={`${s} inline-block animate-spin rounded-full border-2 border-brand border-t-transparent`} />;
}

/** Bottom sheet for confirmations (never window.confirm: it blocks the PWA). */
export function Sheet({ children, onClose }: { children: ReactNode; onClose(): void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/30" onClick={onClose}>
      <div className="w-full rounded-t-2xl bg-white p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function SheetButtons({
  primary,
  secondary,
}: {
  primary: { label: string; onClick(): void; danger?: boolean };
  secondary: { label: string; onClick(): void };
}) {
  return (
    <div className="flex gap-3">
      <button
        onClick={primary.onClick}
        className={`min-h-12 flex-1 rounded-xl font-medium text-white ${primary.danger ? 'bg-red-600' : 'bg-brand'}`}
      >
        {primary.label}
      </button>
      <button onClick={secondary.onClick} className="min-h-12 flex-1 rounded-xl border border-slate-300 font-medium">
        {secondary.label}
      </button>
    </div>
  );
}

export function BillList({ bills, thumbs }: { bills: BillRow[]; thumbs: Record<string, string> }) {
  return (
    <ul className="divide-y divide-slate-100">
      {bills.map((b) => (
        <BillItem key={b.id} bill={b} thumb={b.page_paths[0] ? thumbs[b.page_paths[0]] : undefined} />
      ))}
    </ul>
  );
}

function BillItem({ bill, thumb }: { bill: BillRow; thumb: string | undefined }) {
  const { t } = useTranslation();
  const icon = KIND_ICON[bill.bill_kind ?? ''] ?? (bill.page_paths[0]?.endsWith('.pdf') ? '📄' : '🧾');
  const reading = bill.status === 'processing' || bill.status === 'uploading';
  const title =
    bill.status === 'done'
      ? (bill.vendor_name ?? (bill.ai_pending ? t('savedPending') : '—'))
      : bill.status === 'failed'
        ? t('failed')
        : t('processing');
  return (
    <li>
      <Link to={`/bill/${bill.id}`} className="flex min-h-16 items-center gap-3 py-3 active:bg-slate-50">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-2xl">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium ${bill.status === 'failed' ? 'text-red-600' : ''}`}>{title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
            <span>{fmtDate(bill.bill_date ?? bill.created_at)}</span>
            {bill.ai_pending && <Chip tone="sky">{t('detailsSoon')}</Chip>}
            {bill.duplicate_of && !bill.confirmed_at && <Chip tone="amber">{t('duplicateChip')}</Chip>}
            {bill.needs_fix && !bill.ai_pending && !bill.confirmed_at && <Chip tone="amber">{t('fix')}</Chip>}
            {bill.confirmed_at && <span aria-label={t('confirmed')}>✓</span>}
          </p>
        </div>
        {bill.status === 'done' && bill.total != null && (
          <span className="font-semibold tabular-nums">{inr(bill.total)}</span>
        )}
        {reading && <Spinner size="sm" />}
      </Link>
    </li>
  );
}

export function Chip({ tone, children }: { tone: 'amber' | 'sky' | 'slate'; children: ReactNode }) {
  const cls = { amber: 'bg-amber-100 text-amber-800', sky: 'bg-sky-100 text-sky-800', slate: 'bg-slate-100 text-slate-700' }[
    tone
  ];
  return <span className={`rounded px-1.5 text-xs leading-5 ${cls}`}>{children}</span>;
}
