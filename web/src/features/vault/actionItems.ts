/** "Action needed" block on Home: pure logic so it is easy to test. */

export interface ActionBill {
  id: string;
  vendor_name: string | null;
  needs_fix: boolean;
  ai_pending: boolean;
  confirmed_at: string | null;
  duplicate_of: string | null;
  status: string;
}

export interface ActionProduct {
  bill_id: string;
  name: string | null;
  warranty_until: string | null;
  exchange_until: string | null;
  vendor_name: string | null;
}

export type ActionItem =
  | { kind: 'exchange'; billId: string; label: string; days: number }
  | { kind: 'warranty'; billId: string; label: string; days: number }
  | { kind: 'fix'; billId: string; label: string }
  | { kind: 'duplicate'; billId: string; label: string }
  | { kind: 'pending'; count: number }
  | { kind: 'due'; vendorId: string; label: string; amount: number }
  | { kind: 'laundry'; billId: string; label: string; pieces: number | null; since: string };

export interface ActionDue {
  vendorId: string;
  name: string;
  balance: number;
}

export interface ActionLaundry {
  id: string;
  vendor_name: string | null;
  created_at: string;
  pieces: number | null;
}

export const EXCHANGE_WINDOW_DAYS = 7;
export const WARRANTY_WINDOW_DAYS = 30;

function daysUntil(iso: string, today: Date): number {
  const d = new Date(`${iso}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

export function buildActionItems(
  bills: ActionBill[],
  products: ActionProduct[],
  today: Date,
  dues: ActionDue[] = [],
  laundry: ActionLaundry[] = [],
): ActionItem[] {
  const items: ActionItem[] = [];

  for (const p of products) {
    const label = p.vendor_name ?? p.name ?? '—';
    if (p.exchange_until) {
      const days = daysUntil(p.exchange_until, today);
      if (days >= 0 && days <= EXCHANGE_WINDOW_DAYS) {
        items.push({ kind: 'exchange', billId: p.bill_id, label, days });
      }
    }
    if (p.warranty_until) {
      const days = daysUntil(p.warranty_until, today);
      if (days >= 0 && days <= WARRANTY_WINDOW_DAYS) {
        items.push({ kind: 'warranty', billId: p.bill_id, label, days });
      }
    }
  }
  // Soonest deadlines first.
  items.sort((a, b) => ('days' in a ? a.days : 99) - ('days' in b ? b.days : 99));

  for (const l of laundry) {
    items.push({ kind: 'laundry', billId: l.id, label: l.vendor_name ?? '—', pieces: l.pieces, since: l.created_at });
  }
  for (const d of dues) {
    if (d.balance > 0) items.push({ kind: 'due', vendorId: d.vendorId, label: d.name, amount: d.balance });
  }

  for (const b of bills) {
    if (b.status !== 'done' || b.confirmed_at) continue;
    const label = b.vendor_name ?? '—';
    if (b.duplicate_of) items.push({ kind: 'duplicate', billId: b.id, label });
    else if (b.needs_fix && !b.ai_pending) items.push({ kind: 'fix', billId: b.id, label });
  }

  const pending = bills.filter((b) => b.ai_pending).length;
  if (pending) items.push({ kind: 'pending', count: pending });
  return items;
}
