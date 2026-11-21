/* Service worker: permite instalar o app e abrir mesmo com internet instável.
 * Estratégia: rede primeiro, cache como reserva (assim as atualizações aparecem logo). */
var CACHE = 'agenda-v1';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;   // a API (outra origem) nunca é cacheada
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copia = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
      return res;
    }).catch(function () { return caches.match(req); })
  );
});

// notificações de lembrete (enviadas pelo FCM como mensagem de dados)
self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { p = {}; }
  var d = p.data || p, n = p.notification || {};
  var slug = d.slug || '';
  var titulo = d.titulo || n.title || 'Lembrete de agendamento';
  var opcoes = { body: d.corpo || n.body || '', tag: d.tag || undefined, data: { slug: slug }, icon: slug ? 'p/' + slug + '/icon-192.png' : undefined, badge: slug ? 'p/' + slug + '/badge-96.png' : undefined };
  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var slug = (e.notification.data && e.notification.data.slug) || '';
  var alvo = new URL(slug ? 'p/' + slug + '/' : './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    for (var i = 0; i < lista.length; i++) { if (lista[i].url.indexOf(alvo) === 0 && 'focus' in lista[i]) return lista[i].focus(); }
    return self.clients.openWindow(alvo);
  }));
});
