
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './src/index.css';
import { isSupabaseConfigured } from './src/lib/supabase';

// CRITICAL: Cache/SW Buster
// If we detect that the app is misconfigured (likely due to a cached build with old placeholders),
// we attempt to clear the Service Worker to force a fresh fetch of the new assets.
const checkAndClearCache = async () => {
  if (!isSupabaseConfigured() && 'serviceWorker' in navigator) {
    console.log('[BOOT] Configuração inválida detectada. Limpando Service Workers para evitar DNS Cache trap...');
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
  }
};

checkAndClearCache();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register Service Worker for Push Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('SW registered: ', registration);
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New SW version available. Please refresh.');
                // Optional: alert the user or force reload
              }
            });
          }
        });
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}
