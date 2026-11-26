import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { brand } from '../../config/brand';
import { supabase } from '../../lib/supabase';
import { fmtDate } from '../vault/format';
import { Banner, Spinner } from '../vault/ui';
import { UpgradeSheet } from './UpgradeSheet';
import { usePlan } from './usePlan';

interface Member {
  user_id: string;
  role: 'owner' | 'member';
  name: string | null;
  email: string | null;
}

/** Scans left, buy more, and family sharing (invite link). */
export function PlanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { household, plans, view, reload } = usePlan();
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [paid, setPaid] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!household) return;
    const [{ data: u }, { data }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('household_members', { p_household: household.id }),
    ]);
    setMe(u.user?.id ?? null);
    setMembers((data ?? []) as Member[]);
  }, [household]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  if (!household || !view) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const isOwner = me === household.owner_id;
  const full = members.length >= view.memberLimit;

  const invite = async () => {
    setInviting(true);
    setError(false);
    const { data, error: e } = await supabase
      .from('household_invites')
      .insert({ household_id: household.id, created_by: me })
      .select('token')
      .single();
    setInviting(false);
    if (e || !data) {
      setError(true);
      return;
    }
    const url = `${window.location.origin}/join/${data.token as string}`;
    setInviteUrl(url);
    const text = t('inviteText', { app: brand.name, url });
    if (navigator.share) await navigator.share({ text }).catch(() => undefined);
    else await navigator.clipboard.writeText(text).catch(() => undefined);
  };

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 pt-3 pb-16">
      <header className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate('/')} className="-ml-2 h-11 w-11 rounded-full text-2xl active:bg-slate-100" aria-label={t('back')}>
          ‹
        </button>
        <h1 className="text-lg font-semibold">{t('planTitle')}</h1>
      </header>
      {paid && <Banner tone="sky">{t('paidThanks')}</Banner>}

      <section className="rounded-2xl border border-slate-200 p-4">
        <p className="text-sm text-slate-500">{t('scansLeft')}</p>
        <p className="text-3xl font-semibold">{view.total}</p>
        <p className="mt-1 text-sm text-slate-600">
          {t('freeLeftMonth', { count: view.freeLeft })} · {t('paidScans', { count: view.credits })}
        </p>
        {view.familyActive && household.plan_until && (
          <p className="mt-1 text-sm text-emerald-700">{t('familyUntil', { date: fmtDate(household.plan_until) })}</p>
        )}
        <button className="mt-4 min-h-12 w-full rounded-xl bg-brand font-medium text-white" onClick={() => setUpgrade(true)}>
          {t('buyScans')}
        </button>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 p-4">
        <h2 className="mb-2 font-medium">{t('familyTitle')}</h2>
        <ul className="mb-3 divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.user_id} className="flex min-h-12 items-center justify-between gap-2 text-sm">
              <span>
                {m.name ?? m.email ?? '—'}
                {m.user_id === me && <span className="text-slate-400"> ({t('you')})</span>}
              </span>
              <span className="text-slate-500">{m.role === 'owner' ? t('roleOwner') : t('roleMember')}</span>
            </li>
          ))}
        </ul>
        <p className="mb-3 text-sm text-slate-500">{t('familyLimit', { count: members.length, limit: view.memberLimit })}</p>
        {isOwner ? (
          full ? (
            <p className="text-sm text-amber-800">{view.familyActive ? t('familyFull') : t('familyNeedsPlan')}</p>
          ) : (
            <button
              className="min-h-12 w-full rounded-xl border border-brand font-medium text-brand disabled:opacity-60"
              disabled={inviting}
              onClick={() => void invite()}
            >
              {inviting ? <Spinner size="sm" /> : `👪 ${t('inviteFamily')}`}
            </button>
          )
        ) : (
          <p className="text-sm text-slate-500">{t('memberNote')}</p>
        )}
        {inviteUrl && <p className="mt-2 text-xs break-all text-slate-500">{t('inviteValid', { url: inviteUrl })}</p>}
        {error && <p className="mt-2 text-sm text-red-700">{t('actionFailed')}</p>}
      </section>

      {upgrade && (
        <UpgradeSheet
          plans={plans}
          householdId={household.id}
          onClose={() => setUpgrade(false)}
          onPaid={() => {
            setUpgrade(false);
            setPaid(true);
            // The webhook may land a moment later; reload twice.
            void reload();
            window.setTimeout(() => void reload(), 4000);
          }}
        />
      )}
    </main>
  );
}
