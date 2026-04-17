
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  
  let data = { 
    title: 'Lembrete de Medicamento', 
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

  const options = {
    body: data.body || 'Hora de tomar seu medicamento.',
    icon: 'https://cdn-icons-png.flaticon.com/512/1048/1048953.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/1048/1048953.png',
    vibrate: [100, 50, 100],
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
