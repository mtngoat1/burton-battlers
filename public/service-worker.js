const CACHE_NAME = 'burton-battlers-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {
    title: 'Burton Battlers',
    body: 'You have a new update.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: '/',
  };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    data.body = event.data ? event.data.text() : data.body;
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || data.id || data.type || 'burton-battlers',
    renotify: true,
    data: {
      url: data.url || data.data?.url || '/',
      ...data.data,
    },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Burton Battlers', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      if ('focus' in client) {
        client.focus();
        if ('navigate' in client) client.navigate(targetUrl);
        return;
      }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  })());
});
