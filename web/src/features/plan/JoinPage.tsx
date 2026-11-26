import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { resetHouseholdCache, supabase } from '../../lib/supabase';
import { Banner, Spinner } from '../vault/ui';

export const PENDING_INVITE_KEY = 'pendingInvite';

interface Info {
  household_name: string;
  invited_by: string | null;
  valid: boolean;
}

/** /join/:token: "Ramesh invited you to Home vault" → Join. */
export function JoinPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.removeItem(PENDING_INVITE_KEY);
    } catch {
      // ignore
    }
    void supabase.rpc('invite_info', { p_token: token }).then(({ data }) => {
      const rows = (data ?? []) as Info[];
      setInfo(rows[0] ?? null);
    });
  }, [token]);

  const join = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('accept_invite', { p_token: token });
    setBusy(false);
    if (e) {
      setError(e.message.includes('full') ? t('familyFull') : t('inviteInvalid'));
      return;
    }
    resetHouseholdCache();
    navigate('/', { replace: true });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      {info === undefined && (
        <div className="flex justify-center">
          <Spinner />
        </div>
      )}
      {info === null && <Banner tone="red">{t('inviteInvalid')}</Banner>}
      {info && (
        <>
          <p className="mb-2 text-4xl">👪</p>
          <h1 className="mb-2 text-xl font-semibold">
            {t('joinTitle', { name: info.invited_by ?? '—', household: info.household_name })}
          </h1>
          <p className="mb-6 text-slate-600">{t('joinExplain')}</p>
          {!info.valid && <Banner tone="amber">{t('inviteInvalid')}</Banner>}
          {error && <Banner tone="red">{error}</Banner>}
          <button
            className="min-h-12 rounded-xl bg-brand font-medium text-white disabled:opacity-60"
            disabled={!info.valid || busy}
            onClick={() => void join()}
          >
            {busy ? <Spinner size="sm" /> : t('joinButton')}
          </button>
          <button className="mt-3 min-h-11 text-slate-500" onClick={() => navigate('/')}>
            {t('notNow')}
          </button>
        </>
      )}
    </main>
  );
}
