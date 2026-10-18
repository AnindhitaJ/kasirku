/* KasirKu service worker: aplikasi bisa dibuka offline. Data Supabase tidak pernah di-cache di sini. */
const V='kasirku-v4';
const SHELL=['./','index.html','app-supabase.js','config.js','manifest.webmanifest','icon-192.png','icon-512.png'];
const CDN=['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;800&display=swap'];
const EXT=['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'];

self.addEventListener('install',e=>{e.waitUntil((async()=>{
 const c=await caches.open(V);
 await c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})));      // wajib: kalau gagal, instalasi dibatalkan
 await Promise.all(CDN.map(u=>c.add(u).catch(()=>{})))                // CDN: dicoba, tidak wajib
})())});   // tidak skipWaiting otomatis: versi baru menunggu sampai pengguna klik "Muat ulang"

self.addEventListener('activate',e=>{e.waitUntil((async()=>{
 for(const k of await caches.keys())if(k!==V)await caches.delete(k);
 await self.clients.claim()})())});

self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});

const put=(req,r)=>{if(r&&(r.ok||r.type==='opaque'))caches.open(V).then(c=>c.put(req,r.clone())).catch(()=>{});return r};

// File aplikasi: utamakan jaringan (selalu terbaru), tapi jatuh ke cache bila lambat (>3,5 dtk) atau offline
const networkFirst=req=>{
 const net=fetch(req).then(r=>put(req,r));
 const timeout=new Promise((_,rej)=>setTimeout(rej,3500));
 return Promise.race([net,timeout]).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||(req.mode==='navigate'?caches.match('index.html'):Response.error())))};

// Library CDN dan font: utamakan cache
const cacheFirst=req=>caches.match(req).then(r=>r||fetch(req).then(x=>put(req,x)));

self.addEventListener('fetch',e=>{
 const req=e.request,u=new URL(req.url);
 if(req.method!=='GET')return;
 if(u.origin===location.origin)e.respondWith(networkFirst(req));
 else if(EXT.includes(u.hostname))e.respondWith(cacheFirst(req));
 // selain itu (mis. *.supabase.co) langsung ke jaringan
});
