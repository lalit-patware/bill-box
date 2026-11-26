import { createClient } from '@supabase/supabase-js';

import { env } from './env';

// Fallback values keep the module importable before .env is filled in;
// the app shows a setup notice instead of calling Supabase in that case.
export const supabase = createClient(
  env.supabaseUrl || 'http://localhost:54321',
  env.supabaseAnonKey || 'public-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export const BUCKET = 'bills';

export async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return token;
}

let householdCache: { userId: string; householdId: string } | null = null;

/** Call after joining a family so the next upload goes to the shared vault. */
export function resetHouseholdCache(): void {
  householdCache = null;
}

export async function currentHouseholdId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error('Not signed in');
  if (householdCache?.userId === userId) return householdCache.householdId;

  const { data: rows, error } = await supabase
    .from('members')
    .select('household_id, role, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false }) // a family you joined wins over your own empty vault
    .limit(1);
  if (error) throw error;
  const householdId = rows?.[0]?.household_id as string | undefined;
  if (!householdId) throw new Error('No household for user');
  householdCache = { userId, householdId };
  return householdId;
}
