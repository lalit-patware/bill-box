import { useCallback, useEffect, useState } from 'react';

import { api, type PlansResponse } from '../../lib/api';
import { currentHouseholdId, supabase } from '../../lib/supabase';
import { type HouseholdQuota, quotaView, type QuotaView } from './quota';

const FALLBACK: PlansResponse = { enabled: false, free_per_month: 5, plans: [] };

/** Household plan, scans left and how many bills wait for scans. */
export function usePlan(refreshKey = 0) {
  const [household, setHousehold] = useState<HouseholdQuota | null>(null);
  const [plans, setPlans] = useState<PlansResponse>(FALLBACK);
  const [blocked, setBlocked] = useState(0);

  const load = useCallback(async () => {
    try {
      const id = await currentHouseholdId();
      const [h, b, p] = await Promise.all([
        supabase
          .from('households')
          .select('id,name,plan,plan_until,scan_credits,free_used,free_month,owner_id')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('bills')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', id)
          .eq('quota_blocked', true)
          .eq('ai_pending', true),
        api.plans().catch(() => FALLBACK),
      ]);
      if (h.data) setHousehold(h.data as HouseholdQuota);
      setBlocked(b.count ?? 0);
      setPlans(p);
    } catch {
      // offline: keep last values
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const view: QuotaView | null = household ? quotaView(household, plans.free_per_month, new Date()) : null;
  return { household, plans, view, blocked, reload: load };
}
