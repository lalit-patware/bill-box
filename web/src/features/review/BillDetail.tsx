import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../../lib/api';
import { db } from '../../lib/db';
import { BUCKET, supabase } from '../../lib/supabase';
import { decodeImage, toUploadJpeg } from '../capture/preprocess';
import { fmtDate, inr, KIND_ICON } from '../vault/format';
import { Banner, Chip, Sheet, SheetButtons, Spinner } from '../vault/ui';
import { afterEdit, type BillDetailRow, type EditableField, openPdf, usePageImages, useBill } from './useBill';

type Busy = null | 'confirm' | 'reread' | 'page' | 'delete' | 'save';

export function BillDetail() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, missing, offline, reload } = useBill(id);
  const images = usePageImages(data?.bill.page_paths ?? []);
  const [busy, setBusy] = useState<Busy>(null);
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pageInput = useRef<HTMLInputElement>(null);

  if (missing) {
    return (
      <Shell onBack={() => navigate('/')}>
        <p className="py-16 text-center text-slate-500">{t('billMissing')}</p>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell onBack={() => navigate('/')}>
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      </Shell>
    );
  }

  const { bill, items, products } = data;
  const low = new Set(bill.validation?.low_confidence_fields ?? []);
  const reading = bill.status === 'processing' || bill.status === 'uploading';
  const canWrite = !offline && !reading;

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await fn();
      await reload();
    } catch {
      setMessage(t('actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  const update = async (fields: Partial<BillDetailRow>) => {
    const { error } = await supabase.from('bills').update(fields).eq('id', bill.id);
    if (error) throw error;
  };

  const confirm = () =>
    run('confirm', () => update({ confirmed_at: new Date().toISOString(), needs_fix: false }));

  const keepBoth = () => run('confirm', () => update({ duplicate_of: null }));

  const reread = () => run('reread', async () => void (await api.extractBill(bill.id)));

  const saveField = (field: EditableField, raw: string) =>
    run('save', async () => {
      const value = field === 'total' ? (raw.trim() === '' ? null : Number(raw)) : raw.trim() || null;
      if (field === 'total' && value !== null && Number.isNaN(value)) throw new Error('bad number');
      await update({ [field]: value, ...afterEdit(bill, field) } as Partial<BillDetailRow>);
      setEditing(null);
    });

  const addPage = (file: File | undefined) => {
    if (!file) return;
    void run('page', async () => {
      const bitmap = await decodeImage(file);
      const jpeg = await toUploadJpeg(bitmap);
      bitmap.close();
      const path = `${bill.household_id}/${bill.id}/${bill.page_paths.length + 1}.jpg`;
      const up = await supabase.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      await update({ page_paths: [...bill.page_paths, path] });
      await api.extractBill(bill.id); // re-read all pages together
    });
  };

  const remove = () =>
    run('delete', async () => {
      if (bill.page_paths.length) await supabase.storage.from(BUCKET).remove(bill.page_paths);
      const { error } = await supabase.from('bills').delete().eq('id', bill.id);
      if (error) throw error;
      await db.cache.delete(`bill:${bill.id}`);
      await db.images.bulkDelete(bill.page_paths);
      navigate('/', { replace: true });
    });

  const kindLabel = t(`kind_${bill.bill_kind ?? 'general'}`);
  const milkDays = bill.raw_extraction?.milk_days ?? [];
  const litres = milkDays.reduce((s, d) => s + (d.litres ?? 0), 0);

  return (
    <Shell onBack={() => navigate('/')} title={bill.vendor_name ?? t('savedPending')}>
      {offline && <Banner tone="amber">{t('offlineCopy')}</Banner>}
      {reading && (
        <Banner tone="slate">
          <span className="flex items-center gap-2">
            <Spinner size="sm" /> {t('processing')}
          </span>
        </Banner>
      )}
      {bill.ai_pending && <Banner tone="sky">{t('pendingExplain')}</Banner>}
      {bill.duplicate_of && !bill.confirmed_at && (
        <Banner tone="amber">
          <p className="mb-2">
            {t('duplicateExplain')}{' '}
            <Link className="underline" to={`/bill/${bill.duplicate_of}`}>
              {t('openSaved')}
            </Link>
          </p>
          <div className="flex gap-2">
            <button className="min-h-11 rounded-lg bg-white px-3 font-medium" onClick={() => void keepBoth()} disabled={!canWrite}>
              {t('keepBoth')}
            </button>
            <button className="min-h-11 rounded-lg px-3 font-medium text-red-700" onClick={() => setAskDelete(true)} disabled={!canWrite}>
              {t('deleteThis')}
            </button>
          </div>
        </Banner>
      )}
      {message && <Banner tone="red">{message}</Banner>}

      {/* Pages */}
      <div className="-mx-4 mb-4 flex snap-x gap-2 overflow-x-auto px-4">
        {bill.page_paths.map((p, i) =>
          p.endsWith('.pdf') ? (
            <button
              key={p}
              onClick={() => void openPdf(p)}
              className="flex h-56 w-40 shrink-0 snap-start flex-col items-center justify-center rounded-xl bg-slate-100 text-slate-600"
            >
              <span className="text-4xl">📄</span>
              {t('openPdf')}
            </button>
          ) : (
            <button key={p} onClick={() => images[p] && setZoom(images[p]!)} className="h-56 shrink-0 snap-start" aria-label={t('page', { n: i + 1 })}>
              {images[p] ? (
                <img src={images[p]} alt="" className="h-56 w-auto rounded-xl border border-slate-200 object-contain" />
              ) : (
                <span className="flex h-56 w-40 items-center justify-center rounded-xl bg-slate-100">
                  <Spinner />
                </span>
              )}
            </button>
          ),
        )}
        {canWrite && (
          <button
            onClick={() => pageInput.current?.click()}
            disabled={busy !== null}
            className="flex h-56 w-28 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-500"
          >
            {busy === 'page' ? <Spinner /> : <span className="text-3xl">＋</span>}
            <span className="text-sm">{t('addPage')}</span>
          </button>
        )}
        <input ref={pageInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addPage(e.target.files?.[0])} />
      </div>

      {/* Fields */}
      <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
        <Row label={t('field_kind')}>
          <span aria-hidden>{KIND_ICON[bill.bill_kind ?? ''] ?? '🧾'}</span> {kindLabel}
        </Row>
        <EditableRow
          field="vendor_name"
          label={t('field_vendor')}
          value={bill.vendor_name ?? ''}
          display={bill.vendor_name}
          flagged={low.has('vendor_name')}
          {...{ editing, setEditing, saveField, canWrite, busy }}
          aiPending={bill.ai_pending}
        />
        <EditableRow
          field="bill_date"
          label={t('field_date')}
          value={bill.bill_date ?? ''}
          display={bill.bill_date ? fmtDate(bill.bill_date) : null}
          flagged={low.has('bill_date')}
          inputType="date"
          {...{ editing, setEditing, saveField, canWrite, busy }}
          aiPending={bill.ai_pending}
        />
        <EditableRow
          field="total"
          label={t('field_total')}
          value={bill.total?.toString() ?? ''}
          display={bill.total != null ? inr(bill.total) : null}
          flagged={low.has('total') || bill.total_mismatch}
          hint={
            bill.total_mismatch && bill.validation?.items_sum != null
              ? t('mismatchHint', { sum: inr(bill.validation.items_sum) })
              : undefined
          }
          inputType="number"
          {...{ editing, setEditing, saveField, canWrite, busy }}
          aiPending={bill.ai_pending}
        />
        <EditableRow
          field="bill_no"
          label={t('field_billNo')}
          value={bill.bill_no ?? ''}
          display={bill.bill_no}
          flagged={low.has('bill_no')}
          {...{ editing, setEditing, saveField, canWrite, busy }}
          aiPending={bill.ai_pending}
        />
        {products.map((p) => (
          <div key={p.id}>
            {p.warranty_until && <Row label={t('field_warranty')}>{fmtDate(p.warranty_until)}</Row>}
            {p.exchange_until && <Row label={t('field_exchange')}>{fmtDate(p.exchange_until)}</Row>}
            {p.serial_no && <Row label={t('field_serial')}>{p.serial_no}</Row>}
          </div>
        ))}
        {milkDays.length > 0 && (
          <Row label={t('field_milk')}>{t('milkSummary', { days: milkDays.filter((d) => d.litres).length, litres })}</Row>
        )}
        {bill.raw_extraction?.piece_count?.value != null && (
          <Row label={t('field_pieces')}>{bill.raw_extraction.piece_count.value}</Row>
        )}
        {bill.raw_extraction?.notes?.value && <Row label={t('field_notes')}>{bill.raw_extraction.notes.value}</Row>}
      </dl>

      {items.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-medium text-slate-500">{t('items', { count: items.length })}</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {items.map((it, idx) => (
              <li key={it.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{it.name}</p>
                  {(it.qty != null || it.rate != null) && (
                    <p className="text-sm text-slate-500">
                      {it.qty ?? ''} {it.unit ?? ''} {it.rate != null && `× ${inr(it.rate)}`}
                      {bill.validation?.line_mismatches.includes(idx) && (
                        <span className="ml-2">
                          <Chip tone="amber">{t('checkLine')}</Chip>
                        </span>
                      )}
                    </p>
                  )}
                </div>
                {it.amount != null && <span className="tabular-nums">{inr(it.amount)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-3">
        {bill.status === 'done' && !bill.confirmed_at && !bill.ai_pending && (
          <button
            onClick={() => void confirm()}
            disabled={!canWrite || busy !== null}
            className="min-h-12 rounded-xl bg-brand font-medium text-white disabled:opacity-60"
          >
            {busy === 'confirm' ? <Spinner size="sm" /> : t('looksRight')}
          </button>
        )}
        {bill.confirmed_at && <p className="text-center text-sm text-emerald-700">✓ {t('confirmed')}</p>}
        <div className="flex gap-3">
          <button
            onClick={() => void reread()}
            disabled={!canWrite || busy !== null}
            className="min-h-12 flex-1 rounded-xl border border-slate-300 font-medium disabled:opacity-50"
          >
            {busy === 'reread' ? <Spinner size="sm" /> : t('readAgain')}
          </button>
          <button
            onClick={() => setAskDelete(true)}
            disabled={!canWrite || busy !== null}
            className="min-h-12 flex-1 rounded-xl border border-red-200 font-medium text-red-700 disabled:opacity-50"
          >
            {t('delete')}
          </button>
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full object-contain" style={{ touchAction: 'pinch-zoom' }} />
          <button className="absolute top-4 right-4 h-11 w-11 rounded-full bg-white/20 text-2xl text-white" aria-label={t('close')}>
            ×
          </button>
        </div>
      )}

      {askDelete && (
        <Sheet onClose={() => setAskDelete(false)}>
          <p className="mb-1 text-lg">{t('deleteTitle')}</p>
          <p className="mb-4 text-slate-600">{t('deleteExplain')}</p>
          <SheetButtons
            primary={{
              label: t('delete'),
              danger: true,
              onClick: () => {
                setAskDelete(false);
                void remove();
              },
            }}
            secondary={{ label: t('cancel'), onClick: () => setAskDelete(false) }}
          />
        </Sheet>
      )}
    </Shell>
  );
}

function Shell({ children, onBack, title }: { children: React.ReactNode; onBack(): void; title?: string }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 pt-3 pb-16">
      <header className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="-ml-2 h-11 w-11 rounded-full text-2xl active:bg-slate-100" aria-label={t('back')}>
          ‹
        </button>
        <h1 className="truncate text-lg font-semibold">{title}</h1>
      </header>
      {children}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function EditableRow(props: {
  field: EditableField;
  label: string;
  value: string;
  display: string | null;
  flagged: boolean;
  hint?: string;
  inputType?: 'text' | 'date' | 'number';
  editing: EditableField | null;
  setEditing(f: EditableField | null): void;
  saveField(f: EditableField, v: string): Promise<void>;
  canWrite: boolean;
  busy: Busy;
  aiPending: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(props.value);
  const open = props.editing === props.field;

  if (open) {
    return (
      <form
        className="flex flex-col gap-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void props.saveField(props.field, draft);
        }}
      >
        <label className="text-sm text-slate-500" htmlFor={`f-${props.field}`}>
          {props.label}
        </label>
        <input
          id={`f-${props.field}`}
          autoFocus
          type={props.inputType ?? 'text'}
          inputMode={props.inputType === 'number' ? 'decimal' : undefined}
          step={props.inputType === 'number' ? '0.01' : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-12 rounded-xl border border-slate-300 px-3"
        />
        <div className="flex gap-2">
          <button className="min-h-11 flex-1 rounded-xl bg-brand font-medium text-white" disabled={props.busy === 'save'}>
            {props.busy === 'save' ? <Spinner size="sm" /> : t('save')}
          </button>
          <button type="button" className="min-h-11 flex-1 rounded-xl border border-slate-300" onClick={() => props.setEditing(null)}>
            {t('cancel')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
      <dt className="text-sm text-slate-500">
        {props.label}
        {props.hint && <span className="block text-xs text-amber-700">{props.hint}</span>}
      </dt>
      <dd className="flex items-center gap-2 text-right font-medium">
        <span className={props.display ? '' : 'text-slate-400'}>{props.display ?? '—'}</span>
        {props.canWrite && (props.flagged || (!props.display && !props.aiPending)) && (
          <button
            onClick={() => {
              setDraft(props.value);
              props.setEditing(props.field);
            }}
            className="min-h-9 rounded-full bg-amber-100 px-3 text-sm text-amber-900"
          >
            {props.flagged ? t('fix') : t('addValue')}
          </button>
        )}
        {props.canWrite && !props.flagged && props.display && (
          <button
            onClick={() => {
              setDraft(props.value);
              props.setEditing(props.field);
            }}
            className="min-h-9 px-2 text-sm text-slate-400"
            aria-label={t('edit')}
          >
            ✎
          </button>
        )}
      </dd>
    </div>
  );
}
