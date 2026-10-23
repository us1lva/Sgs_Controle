// Service worker: guarda só o "casco" do app para abrir rápido/instalar como PWA.
// Dados (Supabase) NUNCA são cacheados — estoque desatualizado é pior que nenhum.
const VERSAO = 'v1';
const CASCO = ['./', 'index.html', 'css/style.css', 'js/utils.js', 'js/app.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCO)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== location.origin) return;   // Supabase/CDN: direto na rede
  // Rede primeiro (sempre a versão nova), cache como reserva offline.
  e.respondWith(fetch(req).then(res => {
    const copia = res.clone();
    caches.open(VERSAO).then(c => c.put(req, copia));
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
