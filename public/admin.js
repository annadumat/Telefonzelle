/* Export-Seite: Aufnahmen auf dem Gerät ansehen, als ZIP teilen, löschen. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const S = window.TZStore;
  let recs = [], logs = [];
  let prepared = null; // { file, ids }
  const urls = [];

  const pad = (n) => String(n).padStart(2, "0");
  const fmtBytes = (b) => b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB";
  const fmtSession = (id) => { const m = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)/.exec(id); return m ? `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]} Uhr` : id; };

  // ---------------------------------------------------------------- PIN
  async function checkPin() {
    let pin = "";
    try { pin = String((await (await fetch("config.json")).json()).adminPin || ""); } catch (_) {}
    if (!pin || sessionStorage.getItem("tz-admin") === "1") return;
    $("pin").hidden = false;
    $("pin-input").focus();
    await new Promise((resolve) => {
      $("pin-form").addEventListener("submit", (e) => {
        e.preventDefault();
        if ($("pin-input").value === pin) { sessionStorage.setItem("tz-admin", "1"); $("pin").hidden = true; resolve(); }
        else { $("pin-msg").textContent = "Falsche PIN"; $("pin-input").value = ""; }
      });
    });
  }

  // ---------------------------------------------------------------- Anzeige
  async function load() {
    recs = await S.listRecordings();
    logs = await S.listLogs();
    const fresh = recs.filter((r) => !r.exported);
    $("st-new").querySelector("b").textContent = fresh.length;
    $("st-new").className = "stat " + (fresh.length ? "warn" : "ok");
    $("st-all").textContent = recs.length;
    $("st-calls").textContent = new Set([...recs.map((r) => r.session), ...logs.map((l) => l.session)]).size;
    $("btn-prep-new").disabled = !fresh.length;
    $("btn-prep-all").disabled = !recs.length;
    $("btn-del-exported").disabled = !recs.some((r) => r.exported);

    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      $("st-size").textContent = fmtBytes(e.usage || 0);
      $("st-size-l").textContent = "belegt" + (e.quota ? ` von ${fmtBytes(e.quota)}` : "");
    } else {
      $("st-size").textContent = fmtBytes(recs.reduce((n, r) => n + (r.size || 0), 0));
    }
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted();
      const el = $("st-persist");
      el.className = "stat " + (p ? "ok" : "warn");
      el.querySelector("b").textContent = p ? "ja" : "nein";
    }
    offlineStatus();
    renderCalls();
  }

  function renderCalls() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const box = $("calls");
    const sessions = [...new Set([...recs.map((r) => r.session), ...logs.map((l) => l.session)])].sort().reverse();
    if (!sessions.length) { box.innerHTML = '<p class="empty">Noch keine Anrufe gespeichert.</p>'; return; }
    box.innerHTML = "";
    for (const s of sessions) {
      const log = (logs.find((l) => l.session === s) || {}).log || {};
      const div = document.createElement("div");
      div.className = "call";
      const dur = log.dauerSekunden != null ? `${Math.floor(log.dauerSekunden / 60)}:${pad(log.dauerSekunden % 60)} min` : "";
      div.innerHTML = `<div class="call-head"><strong>${fmtSession(s)}</strong><small>${dur}${log.aufgelegt ? " · aufgelegt" : ""}</small></div>`;
      for (const r of recs.filter((x) => x.session === s)) {
        const row = document.createElement("div");
        row.className = "rec";
        const url = URL.createObjectURL(S.blobOf(r)); urls.push(url);
        const media = document.createElement(r.mime.startsWith("video") ? "video" : "audio");
        media.controls = true; media.preload = "metadata"; media.src = url; media.playsInline = true;
        const name = document.createElement("span"); name.className = "name"; name.textContent = `${r.name}.${r.ext} · ${fmtBytes(r.size)}`;
        const tag = document.createElement("span"); tag.className = "tag" + (r.exported ? "" : " new"); tag.textContent = r.exported ? "exportiert" : "neu";
        const share = document.createElement("button"); share.textContent = "Teilen";
        share.onclick = () => shareFiles([new File([S.blobOf(r)], `${s}_${r.name}.${r.ext}`, { type: r.mime })], [r.id]);
        row.append(name, tag, media, share);
        div.appendChild(row);
      }
      box.appendChild(div);
    }
  }

  // ---------------------------------------------------------------- Export
  async function prepare(onlyNew) {
    const list = recs.filter((r) => !onlyNew || !r.exported);
    if (!list.length) return;
    $("export-panel").hidden = false;
    $("export-actions").hidden = true;
    $("export-info").textContent = `ZIP wird erstellt (${list.length} Aufnahmen) …`;
    $("export-bar").style.width = "30%";

    const files = list.map((r) => ({ name: `${r.session}/${r.name}.${r.ext}`, blob: S.blobOf(r), date: r.created }));
    for (const s of new Set(list.map((r) => r.session))) {
      const l = logs.find((x) => x.session === s);
      if (l) files.push({ name: `${s}/anruf.json`, text: JSON.stringify(l.log, null, 2), date: l.created });
    }
    const zip = await S.makeZip(files);
    const d = new Date();
    const fname = `telefonzelle_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.zip`;
    prepared = { file: new File([zip], fname, { type: "application/zip" }), ids: list.map((r) => r.id) };

    $("export-bar").style.width = "100%";
    $("export-info").textContent = `${fname} · ${fmtBytes(zip.size)} – bereit.`;
    const dl = $("btn-download");
    if (dl.href) URL.revokeObjectURL(dl.href);
    dl.href = URL.createObjectURL(prepared.file);
    dl.download = fname;
    $("btn-share").hidden = !(navigator.canShare && navigator.canShare({ files: [prepared.file] }));
    $("export-actions").hidden = false;
  }

  async function shareFiles(files, ids) {
    // Wichtig: navigator.share direkt im Tipp aufrufen (iOS verlangt eine Nutzer-Geste)
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: "Telefonzelle Aufnahmen" });
        await S.markExported(ids);
        await load();
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // abgebrochen → nichts markieren
        console.warn(e);
      }
    }
    // Fallback: Download
    const a = document.createElement("a");
    a.href = URL.createObjectURL(files[0]); a.download = files[0].name;
    document.body.appendChild(a); a.click(); a.remove();
    if (confirm("Wurde die Datei gespeichert? Dann als exportiert markieren.")) { await S.markExported(ids); await load(); }
  }

  $("btn-prep-new").onclick = () => prepare(true);
  $("btn-prep-all").onclick = () => prepare(false);
  $("btn-share").onclick = () => prepared && shareFiles([prepared.file], prepared.ids);
  $("btn-download").addEventListener("click", () => {
    setTimeout(async () => {
      if (prepared && confirm("Wurde die ZIP-Datei gespeichert? Dann als exportiert markieren.")) { await S.markExported(prepared.ids); await load(); }
    }, 1200);
  });
  $("btn-del-exported").onclick = async () => {
    const ex = recs.filter((r) => r.exported);
    if (!ex.length) return;
    if (!confirm(`${ex.length} exportierte Aufnahme(n) endgültig vom Gerät löschen?`)) return;
    await S.deleteRecordings(ex.map((r) => r.id));
    // Anruf-Protokolle ohne verbleibende Aufnahmen ebenfalls entfernen
    const left = new Set((await S.listRecordings()).map((r) => r.session));
    await S.deleteLogs(logs.map((l) => l.session).filter((s) => !left.has(s) && ex.some((r) => r.session === s)));
    $("export-panel").hidden = true; prepared = null;
    await load();
  };

  // ---------------------------------------------------------------- Offline-Cache
  function swMessage(msg, onMsg) {
    return navigator.serviceWorker.ready.then((reg) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => onMsg(e.data);
      (reg.active || navigator.serviceWorker.controller).postMessage(msg, [ch.port2]);
    });
  }

  function offlineStatus() {
    const el = $("st-offline");
    if (!("serviceWorker" in navigator)) { el.className = "stat warn"; el.querySelector("b").textContent = "nein"; return; }
    if (!navigator.serviceWorker.controller) {
      el.className = "stat warn"; el.querySelector("b").textContent = "…";
      el.querySelector("span").textContent = "offline: wird vorbereitet";
      navigator.serviceWorker.ready.then(() => setTimeout(offlineStatus, 1500));
      return;
    }
    swMessage("status", (m) => {
      const ok = m.missing.length === 0;
      el.className = "stat " + (ok ? "ok" : "warn");
      el.querySelector("b").textContent = ok ? "ja" : `${m.missing.length} fehlen`;
      el.querySelector("span").textContent = ok ? "offline bereit" : "offline: " + m.missing.join(", ");
    });
  }

  $("btn-refresh").onclick = () => {
    if (!("serviceWorker" in navigator)) return;
    $("refresh-panel").hidden = false;
    $("refresh-info").textContent = "Lade …";
    swMessage("refresh", (m) => {
      if (m.type === "progress") {
        $("refresh-bar").style.width = (100 * m.done / m.total) + "%";
        $("refresh-info").textContent = `${m.done}/${m.total}: ${m.file}`;
      } else if (m.type === "done") {
        $("refresh-info").textContent = m.failed.length ? `Fertig, aber nicht geladen: ${m.failed.join(", ")} (Internet?)` : "Alles aktuell und offline verfügbar ✓";
        offlineStatus();
      }
    });
  };

  checkPin().then(load).catch((e) => { console.error(e); $("calls").innerHTML = `<p class="empty">Fehler: ${e.message}</p>`; });
})();
