const CACHE='vertex-engine-mobile-v3';
const ASSETS=['./','./index.html','./vertex-engine.js','./manifest.webmanifest','./icons/icon-192.svg','./icons/icon-512.svg'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE)
    .then(cache=>cache.addAll(ASSETS))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(
      keys.filter(key=>key.startsWith('vertex-engine-mobile-')&&key!==CACHE)
        .map(key=>caches.delete(key))
    ))
  ])
));

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;

  event.respondWith(
    caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy));
      }
      return response;
    }).catch(()=>caches.match('./index.html')))
  );
});
