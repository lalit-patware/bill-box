export const KIND_ICON: Record<string, string> = {
  retail_fashion: '👕',
  electronics: '📱',
  recurring_milk: '🥛',
  laundry: '🧺',
  textile_kaccha: '🧵',
  vendor_credit: '🛒',
  medical_consult: '🩺',
  hospital: '🏥',
  general: '🧾',
};

export const BILL_KINDS = Object.keys(KIND_ICON);

export function fmtDate(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const inrFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function inr(value: number): string {
  return inrFmt.format(value);
}
