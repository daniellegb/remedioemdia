
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
  const swReceivedAt = new Date().toISOString();
  console.log('[Service Worker] Push Received at:', swReceivedAt);
  
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

  const notificationId = data.id || data.notification_id || data.tag;
  const isAndroid = navigator.userAgent ? navigator.userAgent.includes('Android') : false;

  // Non-blocking telemetry function
  const sendTelemetry = function(eventType, extraData) {
    if (!notificationId) return Promise.resolve();
    try {
      return fetch('/api/telemetry/push-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_id: notificationId,
          event_type: eventType,
          timestamp: new Date().toISOString(),
          tag: data.tag,
          title: data.title,
          user_agent: navigator.userAgent || 'unknown',
          device_type: isAndroid ? 'android' : 'desktop',
          ...extraData
        }),
        keepalive: true
      }).catch(function(err) {
        console.warn('[Service Worker Telemetry Warning] Failed to report ' + eventType + ':', err);
      });
    } catch (err) {
      console.warn('[Service Worker Telemetry Warning] Synchronous fetch error:', err);
      return Promise.resolve();
    }
  };

  // Report initial SW push receipt immediately
  const receiptTelemetryPromise = sendTelemetry('service_worker_push_received', {
    sw_received_at: swReceivedAt,
    scheduled_at: data.scheduled_at
  });

  const resolveUrl = function(path) {
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

  const showNotificationPromise = self.registration.showNotification(data.title || 'Remédio em Dia', options)
    .then(function() {
      console.log('[Service Worker] showNotification succeeded for ID:', notificationId);
      return sendTelemetry('show_notification_completed', {
        completed_at: new Date().toISOString()
      });
    })
    .catch(function(err) {
      console.error('[Service Worker] showNotification failed for ID:', notificationId, err);
      return sendTelemetry('show_notification_failed', {
        failed_at: new Date().toISOString(),
        error: err && err.message ? err.message : String(err)
      });
    });

  event.waitUntil(Promise.all([receiptTelemetryPromise, showNotificationPromise]));
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
