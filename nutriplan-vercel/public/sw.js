// sw.js — Service Worker do NutriPlan PWA
const CACHE = 'nutriplan-v1';
const ASSETS = ['/', '/index.html', '/manifest.json', '/img-hardcore.png', '/img-saudavel.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

// Notificações agendadas
self.addEventListener('message', e => {
  if (e.data?.tipo === 'agendar-notificacoes') {
    agendarNotificacoes(e.data.refeicoes);
  }
});

function agendarNotificacoes(refeicoes) {
  // Limpa timers anteriores
  if (self._timers) self._timers.forEach(t => clearTimeout(t));
  self._timers = [];

  const agora = new Date();
  refeicoes.forEach((ref, idx) => {
    const [h, m] = ref.hora.split(':').map(Number);
    const proxRef = refeicoes[idx + 1];

    // Notifica 30min antes de cada refeição
    const alvo = new Date();
    alvo.setHours(h, m - 30, 0, 0);
    if (alvo <= agora) alvo.setDate(alvo.getDate() + 1); // amanhã

    const delay = alvo - agora;
    const t = setTimeout(() => {
      self.registration.showNotification('🍽️ NutriPlan', {
        body: `Em 30 minutos: ${ref.nome}${proxRef ? '' : ''}. Toque para ver o que comer.`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'refeicao-' + idx,
        data: { refeicaoIdx: idx, plano: ref },
        actions: [
          { action: 'ver', title: '👀 Ver refeição' },
          { action: 'pular', title: '⏭️ Pular refeição' }
        ],
        requireInteraction: true
      });
    }, delay);
    self._timers.push(t);
  });
}

// Clique na notificação
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { action, notification } = e;
  const { refeicaoIdx } = notification.data || {};

  if (action === 'pular') {
    // Avisa o app que a refeição foi pulada
    self.clients.matchAll().then(clients => {
      clients.forEach(c => c.postMessage({ tipo: 'refeicao-pulada', idx: refeicaoIdx }));
    });
    return;
  }

  // Abre/foca o app
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ tipo: 'abrir-refeicao', idx: refeicaoIdx });
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
