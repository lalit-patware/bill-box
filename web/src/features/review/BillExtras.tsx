import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../lib/api';
import { BUCKET, supabase } from '../../lib/supabase';
import { fmtDate } from '../vault/format';
import { Sheet, SheetButtons, Spinner } from '../vault/ui';
import { buildClaimPack, complaintText, serviceSearchUrl } from './claim';
import type { BillDetailRow, ProductRow } from './useBill';

type Bill = BillDetailRow & { laundry_received_at?: string | null };

const card = 'mt-4 rounded-2xl border border-slate-200 p-4';
const primaryBtn = 'min-h-12 w-full rounded-xl bg-brand font-medium text-white disabled:opacity-60';
const ghostBtn = 'min-h-12 flex-1 rounded-xl border border-slate-300 font-medium disabled:opacity-60';

/** Dhobi: one tap when clothes come back (stops the pickup reminder). */
export function LaundryCard({ bill, canWrite, onDone }: { bill: Bill; canWrite: boolean; onDone(): void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (bill.bill_kind !== 'laundry' || bill.status !== 'done') return null;
  const pieces = bill.raw_extraction?.piece_count?.value ?? null;
  if (bill.laundry_received_at) {
    return <p className="mt-4 text-center text-sm text-emerald-700">✓ {t('laundryReceivedOn', { date: fmtDate(bill.laundry_received_at) })}</p>;
  }
  const received = async () => {
    setBusy(true);
    await supabase.from('bills').update({ laundry_received_at: new Date().toISOString() }).eq('id', bill.id);
    setBusy(false);
    onDone();
  };
  return (
    <div className={card}>
      <p className="mb-3 text-sm text-slate-600">{t('laundryAtDhobi', { date: fmtDate(bill.created_at) })}</p>
      <button className={primaryBtn} disabled={!canWrite || busy} onClick={() => void received()}>
        {busy ? <Spinner size="sm" /> : pieces ? t('receivedAll', { count: pieces }) : t('receivedClothes')}
      </button>
    </div>
  );
}

/** Retail bill without an exchange date: ask once, remembered for the shop. */
export function ExchangeDaysCard({
  bill,
  products,
  canWrite,
  onDone,
}: {
  bill: Bill;
  products: ProductRow[];
  canWrite: boolean;
  onDone(): void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (bill.bill_kind !== 'retail_fashion' || bill.status !== 'done' || bill.ai_pending) return null;
  if (products.some((p) => p.exchange_until) || !bill.vendor_name) return null;
  const choose = async (days: number) => {
    setBusy(days);
    setFailed(false);
    try {
      await api.setExchangeDays(bill.id, days);
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={card}>
      <p className="mb-3 text-sm text-slate-600">{t('exchangeAsk', { name: bill.vendor_name })}</p>
      <div className="flex gap-2">
        {[7, 15, 30].map((d) => (
          <button key={d} className={ghostBtn} disabled={!canWrite || busy !== null} onClick={() => void choose(d)}>
            {busy === d ? <Spinner size="sm" /> : t('daysN', { count: d })}
          </button>
        ))}
        <button className={ghostBtn} disabled={!canWrite || busy !== null} onClick={() => void choose(0)}>
          {t('noExchange')}
        </button>
      </div>
      {failed && <p className="mt-2 text-sm text-red-700">{t('actionFailed')}</p>}
    </div>
  );
}

/** Electronics: complaint text to copy/share + one PDF with every page. */
export function ClaimCard({ bill, products }: { bill: Bill; products: ProductRow[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [packing, setPacking] = useState(false);
  const [copied, setCopied] = useState(false);
  const isClaimable = ['electronics', 'hospital', 'medical_consult'].includes(bill.bill_kind ?? '');
  if (!isClaimable || bill.status !== 'done') return null;
  const isHealth = bill.bill_kind !== 'electronics';
  const p = products[0];
  const text = complaintText({
    vendor: bill.vendor_name,
    billDate: bill.bill_date,
    billNo: bill.bill_no,
    total: bill.total,
    product: p?.name ?? null,
    serial: p?.serial_no ?? null,
    warrantyUntil: p?.warranty_until ?? null,
  });

  const share = async () => {
    if (navigator.share) {
      await navigator.share({ text }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    }
  };

  const pack = async () => {
    setPacking(true);
    try {
      const pages: { bytes: Uint8Array; type: 'jpg' | 'pdf' }[] = [];
      for (const path of bill.page_paths) {
        const { data } = await supabase.storage.from(BUCKET).download(path);
        if (data) pages.push({ bytes: new Uint8Array(await data.arrayBuffer()), type: path.endsWith('.pdf') ? 'pdf' : 'jpg' });
      }
      const summary = [
        bill.vendor_name ?? 'Bill',
        bill.bill_date ? `Date: ${fmtDate(bill.bill_date)}` : '',
        bill.bill_no ? `Bill no: ${bill.bill_no}` : '',
        bill.total != null ? `Total: Rs ${bill.total}` : '',
        p?.serial_no ? `Serial: ${p.serial_no}` : '',
        p?.warranty_until ? `Warranty until: ${fmtDate(p.warranty_until)}` : '',
        `Pages: ${pages.length}`,
      ].filter(Boolean);
      const bytes = await buildClaimPack(summary, pages);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const name = `${(bill.vendor_name ?? 'bill').replace(/[^\w-]+/g, '_')}_claim.pdf`;
      const file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => undefined);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } finally {
      setPacking(false);
    }
  };

  return (
    <div className={card}>
      <div className="flex gap-2">
        {!isHealth && (
          <button className={ghostBtn} onClick={() => setOpen(true)}>
            🛠️ {t('claimHelp')}
          </button>
        )}
        <button className={ghostBtn} disabled={packing} onClick={() => void pack()}>
          {packing ? <Spinner size="sm" /> : `📎 ${t('claimPack')}`}
        </button>
      </div>
      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <p className="mb-2 text-lg">{t('claimHelp')}</p>
          <pre className="mb-3 max-h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-wrap">{text}</pre>
          <a
            className="mb-3 flex min-h-11 items-center justify-center rounded-xl border border-slate-300 text-sm"
            href={serviceSearchUrl(p?.name ?? bill.vendor_name ?? '')}
            target="_blank"
            rel="noopener noreferrer"
          >
            🔎 {t('findServiceNumber')}
          </a>
          <SheetButtons
            primary={{ label: copied ? t('copied') : t('shareText'), onClick: () => void share() }}
            secondary={{ label: t('close'), onClick: () => setOpen(false) }}
          />
        </Sheet>
      )}
    </div>
  );
}

/** First doctor/hospital bill: explicit consent (DPDP). Decline → delete option. */
export function MedicalConsent({ bill, onDecline }: { bill: Bill; onDecline(): void }) {
  const { t } = useTranslation();
  const [needed, setNeeded] = useState(false);
  const isMedical = bill.bill_kind === 'medical_consult' || bill.bill_kind === 'hospital';

  useEffect(() => {
    if (!isMedical) return;
    let cancelled = false;
    void supabase
      .from('user_consents')
      .select('kind')
      .eq('kind', 'medical')
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled && !error && !data) setNeeded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isMedical]);

  if (!needed) return null;
  const agree = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (u.user) await supabase.from('user_consents').upsert({ user_id: u.user.id, kind: 'medical' });
    setNeeded(false);
  };
  return (
    <Sheet onClose={() => undefined}>
      <p className="mb-2 text-lg">{t('medicalTitle')}</p>
      <p className="mb-4 text-sm text-slate-600">{t('medicalExplain')}</p>
      <SheetButtons
        primary={{ label: t('medicalAgree'), onClick: () => void agree() }}
        secondary={{
          label: t('medicalDelete'),
          onClick: () => {
            setNeeded(false);
            onDecline();
          },
        }}
      />
    </Sheet>
  );
}
