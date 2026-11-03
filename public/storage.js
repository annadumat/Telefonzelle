/* Lokaler Speicher auf dem Gerät (IndexedDB) + ZIP-Export.
 * Wird von app.js (Anruf) und admin.js (Export) gemeinsam benutzt.
 */
window.TZStore = (() => {
  "use strict";
  const DB_NAME = "telefonzelle";
  let dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        const a = d.createObjectStore("aufnahmen", { keyPath: "id", autoIncrement: true });
        a.createIndex("session", "session");
        d.createObjectStore("anrufe", { keyPath: "session" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("abgebrochen"));
    }));
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const extFor = (mime) => {
    mime = (mime || "").split(";")[0];
    return { "audio/mp4": "m4a", "video/mp4": "mp4", "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav" }[mime] || "bin";
  };

  /** Speichert eine Aufnahme. Gibt den Dateinamen zurück. */
  async function saveRecording(session, name, blob) {
    // iOS-Safari speichert Blobs in IndexedDB zuverlässig; als Absicherung wird auf ArrayBuffer ausgewichen.
    const rec = { session, name, mime: blob.type, ext: extFor(blob.type), size: blob.size, created: Date.now(), exported: false };
    try {
      await tx("aufnahmen", "readwrite", (s) => s.add({ ...rec, blob }));
    } catch (e) {
      const buf = await blob.arrayBuffer();
      await tx("aufnahmen", "readwrite", (s) => s.add({ ...rec, buf }));
    }
    return `${session}/${name}.${rec.ext}`;
  }

  async function saveLog(session, log) {
    await tx("anrufe", "readwrite", (s) => s.put({ session, log, created: Date.now() }));
  }

  async function listRecordings() {
    return tx("aufnahmen", "readonly", (s) => reqP(s.getAll()));
  }
  async function listLogs() {
    return tx("anrufe", "readonly", (s) => reqP(s.getAll()));
  }
  const blobOf = (r) => r.blob || new Blob([r.buf], { type: r.mime });

  async function markExported(ids) {
    const want = new Set(ids);
    await tx("aufnahmen", "readwrite", (s) => {
      const c = s.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        if (want.has(cur.value.id) && !cur.value.exported) cur.update({ ...cur.value, exported: true });
        cur.continue();
      };
    });
  }

  async function deleteRecordings(ids) {
    await tx("aufnahmen", "readwrite", (s) => { ids.forEach((id) => s.delete(id)); });
  }
  async function deleteLogs(sessions) {
    await tx("anrufe", "readwrite", (s) => { sessions.forEach((k) => s.delete(k)); });
  }

  // ---------------------------------------------------------------- ZIP (ohne Kompression)
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  /** files: [{name, blob|text, date}] → Blob (application/zip) */
  async function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const data = f.text != null ? enc.encode(f.text) : new Uint8Array(await f.blob.arrayBuffer());
      const name = enc.encode(f.name);
      const crc = crc32(data);
      const d = new Date(f.date || Date.now());
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // UTF-8
      lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  /** Löscht Offline-Cache und Service Worker (NICHT die Aufnahmen in IndexedDB). */
  async function resetApp() {
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) {}
    try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (_) {}
  }

  return { resetApp, saveRecording, saveLog, listRecordings, listLogs, blobOf, markExported, deleteRecordings, deleteLogs, makeZip, extFor };
})();
