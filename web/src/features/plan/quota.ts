/** Scan quota maths (mirrors charge_scan() in SQL; pure and tested). */

export interface HouseholdQuota {
  id: string;
  name: string;
  plan: 'free' | 'pack' | 'family';
  plan_until: string | null;
  scan_credits: number;
  free_used: number;
  free_month: string | null;
  owner_id: string;
}

export interface QuotaView {
  freeLeft: number;
  credits: number;
  total: number;
  familyActive: boolean;
  memberLimit: number;
}

/** First day of the current month in India (the free counter resets then). */
export function istMonth(now: Date): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function quotaView(h: HouseholdQuota, freePerMonth: number, now: Date): QuotaView {
  const used = h.free_month === istMonth(now) ? h.free_used : 0;
  const freeLeft = Math.max(0, freePerMonth - used);
  const familyActive = h.plan === 'family' && (!h.plan_until || new Date(h.plan_until) >= now);
  return {
    freeLeft,
    credits: h.scan_credits,
    total: freeLeft + h.scan_credits,
    familyActive,
    memberLimit: familyActive ? 6 : 2,
  };
}

export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
