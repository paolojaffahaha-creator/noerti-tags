/* Nörti Arena – Service Worker: macht die Seite installierbar und startet auch bei schlechtem Netz.
   Eigene Seiten/Daten: zuerst Netz (immer aktuell), Cache nur als Rückfall. Schriften/Icons: Cache zuerst.
   Supabase und andere fremde Adressen werden nie angefasst. Bei Änderungen an diesem Ablauf VERSION hochzählen. */
const VERSION = 'v1';
const CACHE = 'noerti-' + VERSION;
const SHELL = ['arena/', 'sammlung/', 'bestenliste/', 'anleitung/', 'f/', 'app/style.css', 'app/common.js', 'app/kampf.js', 'app/feier.js', 'app/pwa.js',
  'config.json', 'figuren.json', 'spieldaten.json', 'manifest.webmanifest', 'app/icons/icon-192.png', 'app/icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((p) => c.add(new Request(p, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('noerti-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const SUPA_LIB = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[\d.]+\//; // feste Version → darf aus dem Cache kommen

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes('/app/icons/')) return e.respondWith(cacheFirst(req));
    return e.respondWith(networkFirst(req));
  }
  if (FONTS.test(req.url) || SUPA_LIB.test(req.url)) e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Nörti Arena</title>'
        + '<body style="font:16px/1.5 system-ui,sans-serif;background:#EEF0F2;color:#18171C;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center">'
        + '<div><p style="font-size:48px;margin:0">📡</p><h1 style="margin:8px 0">Kein Netz</h1><p>Die Nörti Arena braucht Internet. Versuch es gleich nochmal.</p>'
        + '<button onclick="location.reload()" style="font:inherit;padding:12px 18px;border:2px solid #18171C;border-radius:12px;background:#FFD23F">Nochmal</button></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
