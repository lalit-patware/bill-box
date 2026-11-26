import { api } from '../../lib/api';
import { BUCKET, currentHouseholdId, supabase } from '../../lib/supabase';
import type { QueueDeps } from './queue';

export const supabaseDeps: QueueDeps = {
  householdId: currentHouseholdId,
  async userId() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw new Error('Not signed in');
    return data.user.id;
  },
  async insertBill(row) {
    // ignoreDuplicates: a retry after a partial upload must not fail on the existing row.
    const { error } = await supabase.from('bills').upsert(row, { ignoreDuplicates: true });
    if (error) throw error;
  },
  async uploadPage(path, page) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, page, { contentType: page.type || 'image/jpeg', upsert: true });
    if (error) throw error;
  },
  async markProcessing(billId, pagePaths) {
    const { error } = await supabase
      .from('bills')
      .update({ page_paths: pagePaths, status: 'processing' })
      .eq('id', billId);
    if (error) throw error;
  },
  async extract(billId) {
    await api.extractBill(billId);
  },
  async batch(billIds) {
    await api.batchBills(billIds);
  },
  isOnline: () => navigator.onLine,
};
