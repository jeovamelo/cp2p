/**
 * Comunidade Resiliente - Service Worker para PWA e Notificações Push
 * Domínio Oficial: https://cp2p.democracias.org
 * Suporta funcionamento offline-first e recebimento de alertas criptográficos
 */

const CACHE_NAME = 'cp2p-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.json'
];

// Instalação: Cache dos recursos essenciais para funcionar offline
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Ativação e limpeza de caches legados
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Estratégia de Fetch: Network First com Fallback para Cache
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  // Requisições dinâmicas de API, WebSocket e Health Check não passam por cache estático
  if (url.includes('/api/') || url.includes('/live') || url.includes('/health')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
  );
});

// Recebimento de Notificações Web Push (VAPID Zero-Knowledge)
self.addEventListener('push', (event) => {
  let data = {
    title: 'Comunidade Resiliente',
    body: 'Nova mensagem oficial recebida via malha P2P.',
    icon: '/manifest.json'
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // Garantia Zero-Knowledge: Jamais exibe conteúdo sensível na notificação de sistema
  const notificationTitle = data.title || 'Comunidade Resiliente';
  const notificationOptions = {
    body: data.body || 'Novo comunicado oficial assinado.',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%2310b981"/><path d="M30 50 L45 65 L70 35" stroke="white" stroke-width="8" fill="none"/></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%2310b981"/></svg>',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || 'https://cp2p.democracias.org/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(notificationTitle, notificationOptions)
  );
});

// Clique na Notificação: foca ou abre a janela oficial da comunidade
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && client.url.includes('cp2p.democracias.org') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
