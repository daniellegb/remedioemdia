// Remédio em Dia - Service Worker
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', function (event) {
  let data = {
    title: 'Remédio em Dia',
    body: 'Passamos por um horário de administração. Confira seus remédios no Painel Hoje.',
    icon: '/remedio-em-dia-icone-small.png',
    tag: 'medication-reminder'
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const resolveUrl = function (path) {
    if (!path) return new URL('/remedio-em-dia-icone-small.png', self.location.origin).href;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    try {
      return new URL(path, self.location.origin).href;
    } catch (e) {
      return new URL('/remedio-em-dia-icone-small.png', self.location.origin).href;
    }
  };

  const notificationId = data.id || data.notification_id || data.tag;

  const options = {
    body: data.body || 'Passamos por um horário de administração. Confira seus remédios no Painel Hoje.',
    icon: resolveUrl(data.icon),
    badge: resolveUrl('/remedio-em-dia-icone-small.png'),
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'medication-reminder',
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || '/historico',
      notificationId: notificationId
    },
    actions: [
      { action: 'view', title: 'Ver no Painel Hoje' },
      { action: 'dismiss', title: 'Ignorar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Remédio em Dia', options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const action = event.action;
  const notificationData = event.notification.data || {};
  let redirectUrl = notificationData.url || '/historico';

  if (action === 'take') {
    redirectUrl = '/historico?action=take';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url && 'focus' in client) {
          client.postMessage({ action: 'notification_clicked', notificationData });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(redirectUrl);
      }
    })
  );
});
