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

export const api = {
  extractBill: (billId: string) => post<Record<string, unknown>>(`/bills/${billId}/extract`),
  batchBills: (billIds: string[]) =>
    post<{ batch_id: string; count: number }>('/bills/batch', { bill_ids: billIds }),
  /** Re-run vendor link, ledger and reminders after the user fixes a field. */
  refreshBill: (billId: string) => post<{ ok: boolean }>(`/bills/${billId}/refresh`),
  /** Shop's exchange window; remembered for that shop's next bills. */
  setExchangeDays: (billId: string, days: number) =>
    post<{ ok: boolean }>(`/bills/${billId}/exchange-days`, { days }),
};
