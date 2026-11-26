/** Web Push opt-in. Subscriptions are stored per user (RLS: own rows only). */
import { env } from './env';
import { supabase } from './supabase';

export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (!env.vapidPublicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Ask permission (must run from a tap), subscribe, save. Returns the new state. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (!env.vapidPublicKey) return 'unconfigured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey),
    }));
  const json = sub.toJSON();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user || !json.endpoint || !json.keys) return 'off';
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.user.id, endpoint: json.endpoint, keys: json.keys }, { onConflict: 'endpoint' });
  return error ? 'off' : 'on';
}
