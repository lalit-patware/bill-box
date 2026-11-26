import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { brand } from '../../config/brand';
import { toggleLanguage } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { AddSheet } from '../capture/AddSheet';
import { useCapture } from '../capture/useCapture';
import type { ActionItem } from './actionItems';
import { fmtDate } from './format';
import { Banner, BillList, Sheet, SheetButtons, Spinner } from './ui';
import { useRecentBills } from './useRecentBills';
import { useActionItems, useSearch, useThumbnails } from './useVaultData';

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const capture = useCapture();
  const { bills, loading, error, fromCache } = useRecentBills(capture.lastRun);
  const actions = useActionItems(capture.lastRun);
  const [query, setQuery] = useState('');
  const { results, searching } = useSearch(query);
  const shown = results ?? bills;
  const thumbs = useThumbnails(shown);

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
      {capture.skipped.length > 0 && <Banner tone="red">{t('skipped', { names: capture.skipped.join(', ') })}</Banner>}
      {capture.duplicatesSkipped > 0 && (
        <Banner tone="slate">{t('duplicatesSkipped', { count: capture.duplicatesSkipped })}</Banner>
      )}

      {/* 1 · Action needed */}
      {!query && actions.length > 0 && <ActionNeeded items={actions} />}

      {/* 2 · Search */}
      <div className="relative mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 pr-10 focus:border-brand focus:bg-white focus:outline-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">
          {searching ? <Spinner size="sm" /> : '🔍'}
        </span>
      </div>

      {/* 3 · Recent / results */}
      <h2 className="mb-1 text-sm font-medium text-slate-500">
        {results ? t('results', { count: results.length }) : t('recent')}
        {fromCache && !results && <span className="ml-2 text-xs">({t('offlineCopy')})</span>}
      </h2>
      {loading && bills.length === 0 && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}
      {!loading && error && capture.online && <Banner tone="red">{t('loadError')}</Banner>}
      {!loading && !error && !results && bills.length === 0 && <p className="py-12 text-center text-slate-500">{t('empty')}</p>}
      {results && results.length === 0 && <p className="py-8 text-center text-slate-500">{t('noResults')}</p>}
      <BillList bills={shown} thumbs={thumbs} />

      {capture.blurryFile && (
        <Sheet onClose={capture.dismissBlurry}>
          <p className="mb-4 text-lg">{t('blurry')}</p>
          <SheetButtons
            primary={{ label: t('retake'), onClick: capture.dismissBlurry }}
            secondary={{
              label: t('useAnyway'),
              onClick: () => void capture.add([capture.blurryFile!], 'camera', { skipBlurCheck: true }),
            }}
          />
        </Sheet>
      )}

      {capture.duplicate && (
        <Sheet onClose={capture.dismissDuplicate}>
          <p className="mb-1 text-lg">{t('duplicateTitle')}</p>
          <p className="mb-4 text-slate-600">
            {capture.duplicate.match.vendor_name ?? t('savedPending')} ·{' '}
            {fmtDate(capture.duplicate.match.bill_date ?? capture.duplicate.match.created_at)}
          </p>
          <SheetButtons
            primary={{
              label: t('openSaved'),
              onClick: () => {
                const id = capture.duplicate!.match.id;
                capture.dismissDuplicate();
                navigate(`/bill/${id}`);
              },
            }}
            secondary={{ label: t('saveAnyway'), onClick: () => void capture.saveDuplicateAnyway() }}
          />
        </Sheet>
      )}

      <AddSheet busy={capture.busy} onFiles={(files, source) => void capture.add(files, source)} />
    </main>
  );
}

function ActionNeeded({ items }: { items: ActionItem[] }) {
  const { t } = useTranslation();
  return (
    <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
      <h2 className="mb-1 px-1 text-sm font-semibold text-amber-900">{t('actionNeeded')}</h2>
      <ul>
        {items.slice(0, 5).map((it, i) => (
          <li key={i}>
            {it.kind === 'pending' ? (
              <p className="flex min-h-11 items-center gap-2 px-1 text-sm text-slate-700">
                <span aria-hidden>⏳</span>
                {t('pendingCount', { count: it.count })}
              </p>
            ) : (
              <Link to={`/bill/${it.billId}`} className="flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm active:bg-amber-100">
                <span aria-hidden>{{ exchange: '🔁', warranty: '🛡️', fix: '✏️', duplicate: '⧉' }[it.kind]}</span>
                <span className="flex-1">
                  {it.kind === 'exchange' && t('exchangeEnds', { name: it.label, count: it.days })}
                  {it.kind === 'warranty' && t('warrantyEnds', { name: it.label, count: it.days })}
                  {it.kind === 'fix' && t('checkDetails', { name: it.label })}
                  {it.kind === 'duplicate' && t('possibleDuplicate', { name: it.label })}
                </span>
                <span className="text-slate-400">›</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
