/** Vendor ledger helpers (pure, tested). */

export interface LedgerRow {
  id: string;
  vendor_id: string;
  month: string; // YYYY-MM-01
  amount_due: number;
  amount_paid: number;
  paid_on: string | null;
}

export interface VendorRow {
  id: string;
  name: string;
  phone: string | null;
  upi_vpa: string | null;
  category: string | null;
  is_recurring: boolean;
}

export interface VendorDue {
  vendor: VendorRow;
  month: string;
  ledgerId: string;
  due: number;
  paid: number;
  balance: number;
}

export function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Unpaid balances, biggest first. Includes older months still open. */
export function openDues(vendors: VendorRow[], ledger: LedgerRow[]): VendorDue[] {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  return ledger
    .map((l) => {
      const vendor = byId.get(l.vendor_id);
      const balance = Math.round((Number(l.amount_due) - Number(l.amount_paid)) * 100) / 100;
      return vendor
        ? { vendor, month: l.month, ledgerId: l.id, due: Number(l.amount_due), paid: Number(l.amount_paid), balance }
        : null;
    })
    .filter((d): d is VendorDue => d !== null && d.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

/** upi://pay link: opens GPay / PhonePe / Paytm with amount pre-filled. */
export function upiLink(vpa: string, name: string, amount: number, note?: string): string {
  const p = new URLSearchParams({ pa: vpa, pn: name, am: amount.toFixed(2), cu: 'INR' });
  if (note) p.set('tn', note.slice(0, 50));
  return `upi://pay?${p.toString()}`;
}

/** Month label like "Nov 2026". */
export function monthLabel(month: string): string {
  return new Date(`${month.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}
