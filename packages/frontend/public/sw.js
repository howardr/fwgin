/* Service worker for Web Push notifications.
 *
 * Receives push events delivered by the Worker, displays a notification, and routes
 * clicks to the relevant game URL.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Fort Worth Gin', body: '', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload; ignore.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.gameId ? `fwgin-${data.gameId}` : 'fwgin',
      data: { url: data.url ?? '/' },
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const matching = clients.find((c) => c.url.includes(target));
      if (matching) return matching.focus();
      return self.clients.openWindow(target);
    }),
  );
});
