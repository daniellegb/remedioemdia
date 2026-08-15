
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  
  let data = { 
    title: 'Remédio em Dia', 
    body: 'Você tem um novo lembrete do Remédio em Dia.' 
  };

  if (event.data) {
    try {
      data = event.data.json();
      console.log('[Service Worker] Push Data:', data);
    } catch (e) {
      console.warn('[Service Worker] Push data is not JSON:', event.data.text());
      data = { 
        title: 'Lembrete', 
        body: event.data.text() 
      };
    }
  }

  const resolveUrl = (path) => {
    if (!path) return new URL('/remedio-em-dia-icone-small.png', self.location.origin).href;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    try {
      return new URL(path, self.location.origin).href;
    } catch (e) {
      return new URL('/remedio-em-dia-icone-small.png', self.location.origin).href;
    }
  };

  const defaultIconUrl = new URL('/remedio-em-dia-icone-small.png', self.location.origin).href;
  const iconUrl = data.icon ? resolveUrl(data.icon) : defaultIconUrl;

  const options = {
    body: data.body || 'Hora de tomar seu medicamento.',
    icon: iconUrl,
    badge: data.badge ? resolveUrl(data.badge) : iconUrl,
    tag: data.tag || 'remedio-em-dia-notification',
    renotify: true,
    requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: data.url || '/dashboard'
    },
    actions: [
      { action: 'open', title: 'Ver Agora' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Remédio em Dia', options)
      .catch(err => console.error('[Service Worker] Error showing notification:', err))
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
