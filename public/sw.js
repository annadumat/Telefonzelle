/* Service Worker: macht die Seite inkl. Videos offline verfügbar.
 * - App-Dateien: aus dem Cache, im Hintergrund aktualisiert, wenn online
 * - Videos: aus dem Cache (mit Range-Unterstützung, die Safari für Videos braucht)
 * - /api/…: nie cachen (nur relevant, wenn server.py benutzt wird)
 */
const CACHE = "telefonzelle-v18";
const APP_FILES = [
  "./", "index.html", "version.js", "style.css", "app.js", "storage.js", "config.json", "avatar.svg",
  "admin.html", "admin.js", "manifest.webmanifest", "icon-512.png", "apple-touch-icon.png",
];

async function mediaFiles() {
  try {
    const r = await fetch("config.json", { cache: "reload" });
    const c = await r.json();
    const list = (c.ablauf || []).map((s) => s.video);
    if (c.anrufer && c.anrufer.bild) list.push(c.anrufer.bild);
    if (c.standbildDatei) list.push(c.standbildDatei);
    return list;
  } catch (_) { return []; }
}

/** Lädt alles (neu) in den Cache. Meldet Fortschritt an die aufrufende Seite. */
async function cacheAll(report) {
  const cache = await caches.open(CACHE);
  const files = [...new Set([...APP_FILES, ...(await mediaFiles())])];
  let done = 0; const failed = [];
  for (const f of files) {
    try {
      const r = await fetch(f, { cache: "reload" });
      if (!r.ok) throw new Error(r.status);
      await cache.put(f, r);
    } catch (e) { failed.push(f); }
    done++;
    report && report({ type: "progress", done, total: files.length, file: f });
  }
  return { files: files.length, failed };
}

self.addEventListener("install", (e) => {
  e.waitUntil(cacheAll().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data === "refresh") {
    const port = e.ports[0];
    cacheAll((m) => port.postMessage(m)).then((res) => port.postMessage({ type: "done", ...res }));
  } else if (e.data === "status") {
    const port = e.ports[0];
    (async () => {
      const cache = await caches.open(CACHE);
      const files = [...new Set([...APP_FILES, ...(await mediaFilesCached(cache))])];
      const missing = [];
      for (const f of files) if (!(await cache.match(f, { ignoreSearch: true }))) missing.push(f);
      port.postMessage({ type: "status", total: files.length, missing });
    })();
  }
});

async function mediaFilesCached(cache) {
  try {
    const r = await cache.match("config.json");
    const c = await r.json();
    const list = (c.ablauf || []).map((s) => s.video);
    if (c.anrufer && c.anrufer.bild) list.push(c.anrufer.bild);
    if (c.standbildDatei) list.push(c.standbildDatei);
    return list;
  } catch (_) { return []; }
}

async function rangeResponse(request, response) {
  const range = request.headers.get("range");
  const blob = await response.blob();
  const type = response.headers.get("content-type") || blob.type || "video/mp4";
  if (!range) {
    return new Response(blob, { status: 200, headers: { "Content-Type": type, "Content-Length": blob.size, "Accept-Ranges": "bytes" } });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : blob.size - 1;
  if (m && !m[1] && m[2]) { start = blob.size - parseInt(m[2], 10); end = blob.size - 1; }
  end = Math.min(end, blob.size - 1);
  if (start >= blob.size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${blob.size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${blob.size}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;

  const isMedia = /\.(mp4|m4v|mov|webm|mp3|m4a)$/i.test(url.pathname);
  if (isMedia) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      let res = await cache.match(url.origin + url.pathname, { ignoreSearch: true });
      if (!res) {
        // Nicht im Cache: aus dem Netz holen und für das nächste Mal speichern
        try {
          const net = await fetch(req.url);
          if (net.ok) { cache.put(req.url, net.clone()); res = net; }
          else return net;
        } catch (_) { return new Response("offline", { status: 404 }); }
      }
      return rangeResponse(req, res);
    })());
    return;
  }

  // App-Dateien: Netz zuerst (immer aktuelle Version), offline bzw. nach 3 s aus dem Cache
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req, { cache: "no-store" }).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; });
    const timeout = new Promise((res) => setTimeout(() => res(null), 3000));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch (_) {}
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try { return await net; } catch (_) { return new Response("offline", { status: 503 }); }
  })());
});
