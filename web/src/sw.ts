/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

import { db } from './lib/db';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA: serve index.html for app routes (offline too).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Web Share Target: WhatsApp/Gallery → "Share" → our app. Save files, then open /share.
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll('files').filter((f): f is File => f instanceof File);
        const now = Date.now();
        if (files.length) {
          await db.shared.bulkAdd(
            files.map((f) => ({ file: f, name: f.name, type: f.type, receivedAt: now })),
          );
        }
      } catch {
        // Fall through to /share, which shows "nothing received".
      }
      return Response.redirect('/share', 303);
    })(),
  );
});

// Phase 4: reminders and "bills ready" notifications.
self.addEventListener('push', (event: PushEvent) => {
  const data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Bill Box', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(self.clients.openWindow(target));
});
