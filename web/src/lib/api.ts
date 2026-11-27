import { env } from './env';
import { accessToken } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (detail as { detail?: string }).detail ?? res.statusText);
  }
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`);
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return (await res.json()) as T;
}

export interface Plan {
  id: string;
  name: string;
  amount_paise: number;
  credits: number;
  family: boolean;
}

export interface PlansResponse {
  enabled: boolean;
  free_per_month: number;
  plans: Plan[];
}

export interface OrderResponse {
  order_id: string;
  key_id: string;
  amount_paise: number;
  name: string;
}

export const api = {
  plans: () => get<PlansResponse>('/payments/plans'),
  createOrder: (plan: string, householdId: string) =>
    post<OrderResponse>('/payments/order', { plan, household_id: householdId }),
  verifyPayment: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    post<{ ok: boolean; credited: boolean; credits: number }>('/payments/verify', r),
  extractBill: (billId: string) => post<Record<string, unknown>>(`/bills/${billId}/extract`),
  batchBills: (billIds: string[]) =>
    post<{ batch_id: string; count: number }>('/bills/batch', { bill_ids: billIds }),
  /** Re-run vendor link, ledger and reminders after the user fixes a field. */
  refreshBill: (billId: string) => post<{ ok: boolean }>(`/bills/${billId}/refresh`),
  /** Shop's exchange window; remembered for that shop's next bills. */
  setExchangeDays: (billId: string, days: number) =>
    post<{ ok: boolean }>(`/bills/${billId}/exchange-days`, { days }),
};
