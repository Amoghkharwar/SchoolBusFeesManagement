import { Platform } from 'react-native';

import { apiFetch } from '@/src/auth';

// Push is a browser-only capability. Note this does NOT reach a plain Android
// WebView wrapper — those need the wrapper's own FCM integration instead.
export const pushSupported = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

export function pushPermission(): PushState {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushState;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

/** Asks for permission, subscribes, and registers the subscription with the API. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushState;

  const { public_key: publicKey, enabled } = await apiFetch<{
    public_key: string;
    enabled: boolean;
  }>('/push/public-key');
  if (!enabled || !publicKey) throw new Error('Push is not configured on the server');

  const reg = await registration();
  await navigator.serviceWorker.ready;

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const raw = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  await apiFetch('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: raw.endpoint, keys: raw.keys ?? {} }),
  });

  // Fired locally, not through the push service: it proves this device can
  // actually draw a notification, which is the step OS-level settings block.
  await reg.showNotification('Notifications enabled', {
    body: "You'll be alerted here when a student or school is added.",
    icon: '/icon-192.png',
    tag: 'push-enabled',
  }).catch(() => {});

  return 'granted';
}

/** Shows a notification without touching the network — isolates display problems. */
export async function showLocalTest(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser does not support notifications');
  if (Notification.permission !== 'granted') {
    throw new Error(`Permission is "${Notification.permission}", not "granted"`);
  }
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!reg) throw new Error('No service worker is registered on this page');
  await reg.showNotification('Local test', {
    body: 'Shown by this device directly — no server involved.',
    icon: '/icon-192.png',
    tag: 'local-test',
  });
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await apiFetch('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Re-registers an already-granted subscription so a rotated endpoint reaches the API. */
export async function syncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    await enablePush();
  } catch {
    // a failed refresh must never block app startup
  }
}
