// Telemetry & IndexedDB Push Service Worker Updated
/* IndexedDB Helper for Telemetry Offline Persistence */
function openTelemetryDB() {
  return new Promise(function(resolve, reject) {
    if (!self.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open('push_telemetry_db', 1);
    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('failed_telemetry')) {
        db.createObjectStore('failed_telemetry', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = function(event) {
      resolve(event.target.result);
    };
    request.onerror = function(event) {
      reject(event.target.error);
    };
  });
}

function saveTelemetryLocally(payload) {
  return openTelemetryDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('failed_telemetry', 'readwrite');
      const store = tx.objectStore('failed_telemetry');
      store.add({ payload: payload, created_at: new Date().toISOString() });
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  }).catch(function(err) {
    console.warn('[Service Worker] Failed to save telemetry locally:', err);
  });
}

function flushPendingTelemetry() {
  return openTelemetryDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('failed_telemetry', 'readwrite');
      const store = tx.objectStore('failed_telemetry');
      const getAllReq = store.getAll();
      getAllReq.onsuccess = function() {
        const records = getAllReq.result || [];
        if (records.length === 0) return resolve();
        
        const sendPromises = records.map(function(record) {
          return fetch('/api/telemetry/push-received', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record.payload),
            keepalive: true
          }).then(function(res) {
            if (res.ok) {
              const delTx = db.transaction('failed_telemetry', 'readwrite');
              delTx.objectStore('failed_telemetry').delete(record.id);
            }
          }).catch(function(e) {
            console.warn('[Service Worker] Flush item failed:', e);
          });
        });
        
        Promise.all(sendPromises).then(function() { resolve(); }).catch(function() { resolve(); });
      };
      getAllReq.onerror = function(e) { reject(e.target.error); };
    });
  }).catch(function(err) {
    // Ignore db errors silently
  });
}

self.addEventListener('install', function(event) {
  console.log('[Service Worker] Installing Service Worker...');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[Service Worker] Service Worker activated.');
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      flushPendingTelemetry()
    ])
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', function(event) {
  const swReceivedAt = new Date().toISOString();
  console.log('[Service Worker] Push Received at:', swReceivedAt);
  
  let data = { 
    title: 'Remédio em Dia', 
    body: 'Você tem um medicamento para tomar agora.',
    icon: '/remedio-em-dia-icone-small.png',
    tag: 'medication-reminder'
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.log('[Service Worker] Push event data was text:', event.data.text());
      data.body = event.data.text();
    }
  }

  const notificationId = data.id || data.notification_id || data.tag;
  const isAndroid = navigator.userAgent ? navigator.userAgent.includes('Android') : false;
  const isIOS = navigator.userAgent ? (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) : false;
  const deviceType = isAndroid ? 'android' : (isIOS ? 'ios' : 'desktop');

  // Helper to obtain subscription endpoint to associate telemetry with specific device
  const getSubEndpoint = function() {
    if (!self.registration || !self.registration.pushManager) {
      return Promise.resolve('');
    }
    return self.registration.pushManager.getSubscription().then(function(sub) {
      return sub ? sub.endpoint : '';
    }).catch(function() {
      return '';
    });
  };

  // Non-blocking telemetry function with local IndexedDB fallback
  const sendTelemetry = function(eventType, extraData) {
    if (!notificationId) return Promise.resolve();
    const eventOccurrenceTime = (extraData && (extraData.sw_received_at || extraData.show_notification_started_at || extraData.completed_at || extraData.failed_at)) || new Date().toISOString();

    return getSubEndpoint().then(function(endpoint) {
      const payload = {
        notification_id: notificationId,
        event_type: eventType,
        timestamp: eventOccurrenceTime,
        tag: data.tag,
        title: data.title,
        user_agent: navigator.userAgent || 'unknown',
        device_type: deviceType,
        endpoint: endpoint || '',
        ...extraData
      };

      try {
        return fetch('/api/telemetry/push-received', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).then(function(res) {
          if (!res.ok) {
            return saveTelemetryLocally(payload);
          }
        }).catch(function(err) {
          console.warn('[Service Worker Telemetry Warning] Failed to report ' + eventType + ', saving locally:', err);
          return saveTelemetryLocally(payload);
        });
      } catch (err) {
        console.warn('[Service Worker Telemetry Warning] Synchronous fetch error, saving locally:', err);
        return saveTelemetryLocally(payload);
      }
    });
  };

  // Flush any previously stored telemetry events that failed during offline/Doze Mode
  const flushPromise = flushPendingTelemetry();

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

  const options = {
    body: data.body || 'Você tem um medicamento para tomar agora.',
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
      { action: 'take', title: 'Tomar Medicamento' },
      { action: 'dismiss', title: 'Ignorar' }
    ]
  };

  const showStartedAt = new Date().toISOString();
  console.log('[Service Worker] Starting showNotification at:', showStartedAt, 'for ID:', notificationId);
  const startedTelemetryPromise = sendTelemetry('show_notification_started', {
    show_notification_started_at: showStartedAt
  });

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

  event.waitUntil(Promise.all([flushPromise, receiptTelemetryPromise, startedTelemetryPromise, showNotificationPromise]));
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification click Received.');
  event.notification.close();
  
  const action = event.action;
  const notificationData = event.notification.data || {};
  let redirectUrl = notificationData.url || '/historico';
  
  if (action === 'take') {
    redirectUrl = '/historico?action=take';
  }

  const flushOnDb = flushPendingTelemetry();

  event.waitUntil(
    Promise.all([
      flushOnDb,
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
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
    ])
  );
});
