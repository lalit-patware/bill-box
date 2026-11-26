import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { brand } from '../../config/brand';
import type { PlansResponse } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { Sheet, Spinner } from '../vault/ui';
import { buyPlan } from './checkout';
import { rupees } from './quota';

/** Plan picker → Razorpay. Used from Home (out of scans) and the Plan page. */
export function UpgradeSheet({
  plans,
  householdId,
  onClose,
  onPaid,
}: {
  plans: PlansResponse;
  householdId: string;
  onClose(): void;
  onPaid(): void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const buy = async (planId: string) => {
    setBusy(planId);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getUser();
      const result = await buyPlan(planId, householdId, brand.name, data.user?.email);
      if (result === 'paid') {
        onPaid();
        return;
      }
      if (result === 'failed') setMessage(t('payFailed'));
    } catch {
      setMessage(t('payFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <p className="mb-1 text-lg">{t('upgradeTitle')}</p>
      <p className="mb-4 text-sm text-slate-600">{t('upgradeExplain', { count: plans.free_per_month })}</p>
      {!plans.enabled && <p className="mb-4 rounded-xl bg-slate-100 p-3 text-sm">{t('paySoon')}</p>}
      <div className="flex flex-col gap-3">
        {plans.plans.map((p) => (
          <button
            key={p.id}
            disabled={!plans.enabled || busy !== null}
            onClick={() => void buy(p.id)}
            className="flex min-h-14 items-center justify-between rounded-xl border-2 border-brand px-4 text-left disabled:opacity-50"
          >
            <span>
              <span className="block font-medium">{p.family ? t('planFamily') : t('planPack', { count: p.credits })}</span>
              <span className="block text-xs text-slate-500">
                {p.family ? t('planFamilyNote', { count: p.credits }) : t('planPackNote')}
              </span>
            </span>
            <span className="text-lg font-semibold text-brand">{busy === p.id ? <Spinner size="sm" /> : rupees(p.amount_paise)}</span>
          </button>
        ))}
      </div>
      {message && <p className="mt-3 text-sm text-red-700">{message}</p>}
      <button className="mt-3 min-h-11 w-full text-slate-500" onClick={onClose}>
        {t('notNow')}
      </button>
    </Sheet>
  );
}
