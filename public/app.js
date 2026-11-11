/* Telefonzelle – Anruf in die Zukunft
 *
 * Ablauf:  Start → Klingeln → Video 1 → Aufnahme → Video 2 → Aufnahme → … → Ende
 * Auflegen ist jederzeit möglich. Aufnahmen werden an den lokalen Server
 * (server.py) geschickt und dort in ./recordings/<Anruf>/ gespeichert.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const video = $("video");
  const selfVideo = $("self-video");

  let config = null;
  let call = null;          // aktueller Anruf (null = kein Anruf)
  let audioCtx = null;
  let stream = null;        // Mikrofon (+ Kamera)
  let storeMode = "geraet"; // "server" (server.py läuft) oder "geraet" (IndexedDB auf dem iPad)

  class Aborted extends Error {}

  // ------------------------------------------------------------------ Hilfen
  const pad = (n) => String(n).padStart(2, "0");
  const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return pad(Math.floor(s / 60)) + ":" + pad(s % 60); };
  const sessionId = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  };

  function show(screen) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + screen));
  }

  /** Wartet auf ein Promise, bricht aber sofort ab, wenn aufgelegt wird. */
  function guard(promise) {
    const c = call;
    return new Promise((resolve, reject) => {
      if (!c || c.aborted) return reject(new Aborted());
      const onAbort = () => reject(new Aborted());
      c.abortHandlers.add(onAbort);
      promise.then(
        (v) => { c.abortHandlers.delete(onAbort); resolve(v); },
        (e) => { c.abortHandlers.delete(onAbort); reject(e); }
      );
    });
  }
  const wait = (ms) => guard(new Promise((r) => setTimeout(r, ms)));

  // ------------------------------------------------------------------ Start
  async function init() {
    try {
      config = await (await fetch("config.json", { cache: "no-store" })).json();
    } catch (e) {
      return showError("config.json konnte nicht geladen werden. Läuft server.py?");
    }
    const a = config.anrufer || {};
    for (const id of ["start-avatar", "ring-avatar", "end-avatar"]) if (a.bild) $(id).src = a.bild;
    $("start-name").textContent = $("ring-name").textContent = $("call-name").textContent = a.name || "Unbekannt";
    $("listen-label").textContent = (a.name || "") + " hört zu …";
    if (config.standbildDatei) $("listen-avatar").src = config.standbildDatei;
    $("start-sub").textContent = a.untertitel || "";

    $("btn-call").addEventListener("click", startCall);
    document.querySelectorAll(".hangup").forEach((b) => b.addEventListener("click", () => hangUp(true)));
    $("btn-done").addEventListener("click", () => call && call.stopRecording && call.stopRecording("button"));

    // Videos im Voraus laden, damit es später nicht ruckelt
    (config.ablauf || []).forEach((s) => { const l = document.createElement("link"); l.rel = "prefetch"; l.href = s.video; document.head.appendChild(l); });

    if (await healIfOutdated()) return;
    tickClock(); setInterval(tickClock, 10000);
    setupAdminGesture();
    storeMode = await detectStoreMode();
    console.log("Speicherort:", storeMode);

    if ("serviceWorker" in navigator && window.isSecureContext) {
      // Neue Version installiert → einmal neu laden, damit sofort aktuelle Videos/Config gelten
      // (nicht während eines Anrufs; dann nach dem Auflegen).
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) return;            // erster Besuch: nichts Altes zu ersetzen
        const reload = () => (call ? setTimeout(reload, 2000) : location.reload());
        reload();
      });
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
        .then((reg) => reg.update())
        .catch((e) => console.warn("Service Worker:", e));
    }
    if (!window.isSecureContext) {
      showError("Achtung: Diese Seite ist nicht über HTTPS/localhost geöffnet – der Browser blockiert das Mikrofon. " +
                "Server mit  python3 server.py --https  starten und die https://-Adresse öffnen.");
    }
  }

  /** Liegt online eine neuere Version, Cache leeren und einmal neu laden (Aufnahmen bleiben). */
  async function healIfOutdated() {
    if (!navigator.onLine) return false;
    try {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 2500);
      const t = await (await fetch("version.js?check=" + Date.now(), { cache: "no-store", signal: ctl.signal })).text();
      const m = /TZ_VERSION\s*=\s*"([^"]+)"/.exec(t);
      if (!m || m[1] === window.TZ_VERSION) return false;
      if (sessionStorage.getItem("tz-heal") === m[1]) return false;   // nur einmal versuchen
      sessionStorage.setItem("tz-heal", m[1]);
      console.log("Neue Version", m[1], "gefunden (läuft:", window.TZ_VERSION, ") – lade neu");
      await TZStore.resetApp();
      location.reload();
      return true;
    } catch (_) { return false; }
  }

  async function detectStoreMode() {
    const wanted = config.speichern || "auto";
    if (wanted === "geraet" || wanted === "server") return wanted;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch("api/ping", { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      if (r.ok && (await r.json()).ok) return "server";
    } catch (_) {}
    return "geraet";
  }

  /** Versteckter Zugang zur Export-Seite: 5× schnell auf die Uhr tippen. */
  function setupAdminGesture() {
    let taps = [];
    $("clock").addEventListener("click", () => {
      const now = Date.now();
      taps = taps.filter((t) => now - t < 3000).concat(now);
      if (taps.length >= 5) location.href = "admin.html";
    });
  }

  function tickClock() {
    const d = new Date();
    $("clock").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + " · " + (config.jahr || d.getFullYear());
  }

  function showError(msg) { const e = $("start-error"); e.textContent = msg; e.hidden = false; }

  async function startCall() {
    if (call) return;
    $("start-error").hidden = true;

    // Alles, was eine Nutzer-Geste braucht (iOS!), passiert JETZT synchron im Klick:
    // 1) AudioContext entsperren, 2) Video-Element entsperren.
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    const first = config.ablauf[0];
    // Video im Klick einmal stumm starten und sofort anhalten: Das gibt es für späteres
    // Abspielen mit Ton frei (iOS), ohne dass während des Klingelns etwas zu hören ist.
    video.muted = true;
    video.src = first.video;
    const unlock = video.play();
    video.pause();
    if (unlock) unlock.catch(() => {});
    video.muted = false;

    call = {
      id: sessionId(),
      started: Date.now(),
      aborted: false,
      abortHandlers: new Set(),
      uploads: [],
      log: { ablauf: [] },
      stopRecording: null,
      timer: null,
      ring: null,
    };

    // 3) Mikrofon/Kamera anfragen
    try {
      await getStream();
    } catch (e) {
      console.error(e);
      call = null;
      return showError("Kein Zugriff auf " + (config.aufnahme === "video" ? "Kamera/Mikrofon" : "das Mikrofon") +
                       ". Bitte im Browser erlauben und neu laden. (" + e.name + ")");
    }

    requestWakeLock();
    if (storeMode === "geraet" && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    runCall().catch((e) => {
      if (!(e instanceof Aborted)) { console.error(e); hangUp(true); }
    });
  }

  async function getStream() {
    if (stream && stream.getTracks().every((t) => t.readyState === "live")) return stream;
    if (stream) releaseStream();   // z. B. von iOS beendet → neu anfordern
    const wantVideo = config.aufnahme === "video";
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: wantVideo ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    const self = $("self");
    if (wantVideo) { selfVideo.srcObject = stream; self.classList.add("has-video"); selfVideo.play().catch(() => {}); }
    else self.classList.remove("has-video");
    return stream;
  }

  function releaseStream() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    selfVideo.srcObject = null;
  }

  // ------------------------------------------------------------------ Ablauf
  async function runCall() {
    // Klingeln
    show("ringing");
    call.ring = ringtone();
    // Anzahl Klingeltöne (Ton 1 s, Pause 2 s); nach dem letzten Ton kurze Pause, dann "Abheben"
    const ringMs = config.klingelnAnzahl
      ? ((config.klingelnAnzahl - 1) * 3 + 1) * 1000 + 800
      : (config.klingelnSekunden ?? 3) * 1000;
    await wait(ringMs);
    call.ring.stop(); call.ring = null;

    // "Abgenommen"
    show("call");
    const t0 = Date.now();
    call.timer = setInterval(() => { $("call-timer").textContent = fmtTime(Date.now() - t0); }, 500);
    if (config.mikrofonNurBeimSprechen) releaseStream();

    const steps = config.ablauf || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const entry = { video: step.video, start: new Date().toISOString() };
      call.log.ablauf.push(entry);

      entry.platzhalter = await playVideo(step.video);

      if (step.danachAufnehmen) {
        await recordAnswer(step.aufnahmeName || `${pad(i + 1)}_antwort`, entry, step.frage);
      }
    }
    await finish(false);
  }

  /** Spielt ein Video ab. Fehlt die Datei, wird ein Platzhalter angezeigt. Gibt true zurück, wenn Platzhalter. */
  async function playVideo(src) {
    showListening(false);
    const ok = await guard(new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; cleanup(); resolve(v); } };
      const onEnd = () => fin(true);
      const onErr = () => fin(false);
      const cleanup = () => { video.removeEventListener("ended", onEnd); video.removeEventListener("error", onErr); video.removeEventListener("timeupdate", captureFrame); };
      video.addEventListener("ended", onEnd);
      video.addEventListener("timeupdate", captureFrame);
      video.addEventListener("error", onErr);
      if (video.error || !video.src.endsWith(src)) video.src = src;
      video.currentTime = 0;
      video.muted = false;
      const p = video.play();
      if (p) p.catch((e) => {
        // Autoplay blockiert? Dann notfalls stumm abspielen statt hängen zu bleiben.
        if (e.name === "NotAllowedError") { video.muted = true; video.play().catch(onErr); }
        else if (e.name !== "AbortError") onErr();
      });
    }));
    if (ok) return false;

    // Platzhalter
    video.removeAttribute("src"); video.load();
    const ph = $("placeholder");
    $("ph-file").textContent = src;
    ph.hidden = false;
    const secs = config.platzhalterSekunden ?? 5;
    try {
      for (let s = secs; s > 0; s--) { $("ph-count").textContent = s; await wait(1000); }
    } finally { ph.hidden = true; }
    return true;
  }

  /** Nimmt einmal pro Video ein Standbild (bei ~1,5 s) als runden Avatar für die Zuhören-Ansicht. */
  let captured = "";
  function captureFrame() {
    if (config.standbildDatei) return;   // festes Bild aus config.json statt automatischem Standbild
    if (video.currentTime < 1.5 || captured === video.currentSrc || !video.videoWidth) return;
    captured = video.currentSrc;
    try {
      const w = video.videoWidth, h = video.videoHeight;
      // Ausschnitt um den Kopf, einstellbar in config.json → "standbild" (Anteile der Videogröße)
      const sb = Object.assign({ mitteX: 0.5, obenY: 0.04, groesse: 0.55 }, config.standbild);
      const size = Math.round(Math.min(w, h) * sb.groesse);
      const sx = Math.max(0, Math.min(w - size, Math.round(w * sb.mitteX - size / 2)));
      const sy = Math.max(0, Math.min(h - size, Math.round(h * sb.obenY)));
      const c = document.createElement("canvas");
      c.width = c.height = 360;
      c.getContext("2d").drawImage(video, sx, sy, size, size, 0, 0, 360, 360);
      $("listen-avatar").src = c.toDataURL("image/jpeg", 0.85);
    } catch (e) { console.warn("Standbild nicht möglich", e); }
  }

  function showListening(on) {
    $("listening").hidden = !on;
    video.style.opacity = on ? "0" : "1";
  }

  // ------------------------------------------------------------------ Aufnahme
  function pickMime(kind) {
    const candidates = kind === "video"
      ? ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      : ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    if (!window.MediaRecorder) return null;
    return candidates.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
  }

  async function recordAnswer(name, entry, frage) {
    // Frage einblenden, die gerade beantwortet werden soll
    const q = $("listen-question");
    q.textContent = frage || "";
    q.hidden = !frage;
    $("listening").classList.toggle("has-question", !!frage);
    const s = await guard(getStream());
    const kind = config.aufnahme === "video" ? "video" : "audio";
    const recStream = kind === "video" ? s : new MediaStream(s.getAudioTracks());
    const mime = pickMime(kind);
    if (mime === null) throw new Error("MediaRecorder wird von diesem Browser nicht unterstützt");

    const rec = new MediaRecorder(recStream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });

    // Pegel-Analyse für automatische Stille-Erkennung
    const src = audioCtx.createMediaStreamSource(s);
    const an = audioCtx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);

    const cfg = Object.assign({ stilleBeendetNachMs: 2500, maxDauerMs: 60000, keineSpracheAbbruchMs: 20000, lautstaerkeSchwelle: 0.035 }, config.sprechen);
    const talk = $("talk"), label = $("talk-label"), bar = $("meter-bar"), self = $("self");
    let smooth = 0, speakingUntil = 0;
    self.classList.add("live");

    let reason = null;
    const stop = (why) => { if (!reason) { reason = why; if (rec.state !== "inactive") rec.stop(); } };
    call.stopRecording = stop;
    call.activeRecording = { stop, name };

    showListening(true);
    label.textContent = "Du kannst jetzt sprechen …";
    talk.hidden = false;
    rec.start(1000);
    const t0 = performance.now();
    entry.aufnahmeStart = new Date().toISOString();

    let noise = 0, noiseN = 0, threshold = cfg.lautstaerkeSchwelle;
    let speechMs = 0, heard = false, lastLoud = t0, last = t0;
    const loop = setInterval(() => {
      const now = performance.now(), dt = now - last; last = now;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);

      // Die ersten 400 ms: Grundrauschen messen und Schwelle anpassen
      if (now - t0 < 400) { noise += rms; noiseN++; return; }
      if (noiseN) { threshold = Math.max(cfg.lautstaerkeSchwelle, (noise / noiseN) * 2.5); noiseN = 0; }

      const lvl = Math.min(1, rms / (threshold * 3));
      smooth = lvl > smooth ? lvl : smooth * 0.85;          // schnell rauf, sanft runter
      bar.style.width = (lvl * 100).toFixed(0) + "%";
      self.style.setProperty("--lvl", smooth.toFixed(2));

      if (rms > threshold) {
        speakingUntil = now + 300;                          // kurz nachleuchten, damit es nicht flackert
        lastLoud = now; speechMs += dt;
        if (speechMs > 300 && !heard) {
          heard = true;
          label.textContent = cfg.stilleBeendetNachMs > 0 ? "Ich höre zu …" : "Tippe auf „Fertig gesprochen“, wenn du fertig bist";
        }
      }
      self.classList.toggle("speaking", now < speakingUntil);
      const elapsed = now - t0;
      // stilleBeendetNachMs = 0: kein automatisches Weiter nach Stille, nur per Knopf
      if (heard && cfg.stilleBeendetNachMs > 0 && now - lastLoud > cfg.stilleBeendetNachMs) stop("stille");
      else if (!heard && elapsed > cfg.keineSpracheAbbruchMs) stop("keine-sprache");
      else if (cfg.maxDauerMs > 0 && elapsed > cfg.maxDauerMs) stop("max-dauer");   // 0 = keine Begrenzung
    }, 50);

    try {
      await stopped;
    } finally {
      clearInterval(loop);
      try { src.disconnect(); } catch (_) {}
      talk.hidden = true;
      bar.style.width = "0";
      self.classList.remove("live", "speaking");
      self.style.setProperty("--lvl", 0);
      call && (call.stopRecording = null, call.activeRecording = null);
    }

    const blob = new Blob(chunks, { type: (rec.mimeType || mime || "").split(";")[0] || (kind + "/webm") });
    const aborted = reason === "aufgelegt";
    entry.aufnahmeEnde = new Date().toISOString();
    entry.aufnahmeGrund = reason;
    entry.sprachErkannt = heard;
    entry.aufnahmeDatei = name + (aborted ? "_abgebrochen" : "");
    upload(blob, entry.aufnahmeDatei, entry);

    if (config.mikrofonNurBeimSprechen) releaseStream();
    if (call && call.aborted) throw new Aborted();
  }

  // ------------------------------------------------------------------ Speichern
  function upload(blob, name, entry) {
    const id = call.id;
    // Ergebnis: { ok, wo: "server" | "geraet", datei, fehler }
    const saveLocal = async (fehler) => {
      try {
        const f = await TZStore.saveRecording(id, name, blob);
        if (entry) entry.gespeichert = "geraet:" + f;
        return { ok: true, wo: "geraet", datei: f, fehler };
      } catch (e) {
        console.error("Lokales Speichern fehlgeschlagen", e);
        return { ok: false, fehler: (fehler ? fehler + "; " : "") + "Browser-Speicher: " + e.message };
      }
    };
    const p = (async () => {
      if (!blob.size) {
        console.error("Aufnahme ist leer (0 Byte) – Mikrofon liefert keine Daten?");
        return { ok: false, fehler: "Aufnahme war leer – Mikrofon prüfen" };
      }
      if (storeMode === "geraet") return saveLocal();
      let fehler = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch("api/upload", {
            method: "POST",
            headers: { "Content-Type": blob.type || "application/octet-stream", "X-Session": id, "X-Name": name },
            body: blob,
          });
          if (r.ok) { const j = await r.json(); if (entry) entry.gespeichert = j.file; return { ok: true, wo: "server", datei: j.file }; }
          fehler = "Server antwortet " + r.status;
        } catch (e) { fehler = "Server nicht erreichbar (" + e.message + ")"; }
        console.warn("Upload fehlgeschlagen:", fehler, "– neuer Versuch …");
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
      // Server nicht erreichbar → auf dem Gerät speichern (Export über admin.html)
      return saveLocal(fehler);
    })();
    call.uploads.push(p);
    return p;
  }

  // ------------------------------------------------------------------ Ende
  function hangUp(byUser) {
    if (!call || call.ended) return;
    call.aborted = byUser;
    if (call.activeRecording) call.activeRecording.stop("aufgelegt");
    // Ein Moment Zeit, damit die abgebrochene Aufnahme noch eingesammelt wird
    setTimeout(() => {
      call.abortHandlers.forEach((fn) => fn());
      call.abortHandlers.clear();
      finish(true);
    }, call.activeRecording ? 300 : 0);
  }

  async function finish(byUser) {
    if (!call || call.ended) return;
    const c = call;
    c.ended = true;
    if (c.ring) c.ring.stop();
    clearInterval(c.timer);
    video.pause();
    video.removeAttribute("src"); video.load();
    $("placeholder").hidden = true;
    $("talk").hidden = true;
    // Mikrofon offen lassen, damit iOS beim nächsten Anruf nicht erneut um Erlaubnis fragt.
    // (Aufgenommen wird nur in den Sprechphasen.) Abschaltbar mit "mikrofonDauerhaftOffen": false.
    if (config.mikrofonDauerhaftOffen === false || config.mikrofonNurBeimSprechen) releaseStream();
    releaseWakeLock();
    if (!byUser) hangupTone();

    const duration = Date.now() - c.started;
    $("end-duration").textContent = (byUser ? "Aufgelegt · " : "") + fmtTime(duration);
    show("end");

    c.log.anrufId = c.id;
    c.log.beginn = new Date(c.started).toISOString();
    c.log.dauerSekunden = Math.round(duration / 1000);
    c.log.aufgelegt = byUser;
    c.log.geraet = navigator.userAgent;

    const results = await Promise.all(c.uploads);
    if (c.uploads.length) {
      const summary = saveSummary(results);   // nicht im Anruf anzeigen – steht auf der Export-Seite
      console.log("Speichern:", summary);
      try { localStorage.setItem("tz-last-save", JSON.stringify({ session: c.id, text: summary, ok: results.every((r) => r.ok) })); } catch (_) {}
    }
    c.log.speicherort = storeMode;
    if (storeMode === "server") {
      fetch("api/log", { method: "POST", headers: { "Content-Type": "application/json", "X-Session": c.id }, body: JSON.stringify(c.log, null, 2) })
        .catch(() => TZStore.saveLog(c.id, c.log).catch(() => {}));
    } else {
      TZStore.saveLog(c.id, c.log).catch((e) => console.error(e));
    }

    await new Promise((r) => setTimeout(r, (config.endbildschirmSekunden ?? 6) * 1000));
    $("call-timer").textContent = "00:00";
    showListening(false);
    call = null;
    show("start");
  }

  function saveSummary(results) {
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    const parts = [];
    if (ok.some((r) => r.wo === "server")) {
      const dir = ok.find((r) => r.wo === "server").datei.replace(/[\\/][^\\/]*$/, "");
      parts.push(`✓ ${ok.filter((r) => r.wo === "server").length} Aufnahme(n) gespeichert in ${dir}`);
    }
    const local = ok.filter((r) => r.wo === "geraet");
    if (local.length) {
      parts.push(`✓ ${local.length} Aufnahme(n) im Browser gespeichert – Export: 5× auf die Uhr tippen` +
                 (local[0].fehler ? ` (${local[0].fehler})` : ""));
    }
    if (bad.length) parts.push(`✗ ${bad.length} nicht gespeichert: ${bad[0].fehler}`);
    return parts.join(" · ");
  }

  // ------------------------------------------------------------------ Töne (offline erzeugt)
  function ringtone() {
    const ctx = audioCtx;
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.frequency.value = 440; o2.frequency.value = 480;   // klassisches Freizeichen
    o1.connect(gain); o2.connect(gain); o1.start(); o2.start();
    let t = ctx.currentTime;
    for (let i = 0; i < 20; i++) {                         // 1 s Ton, 2 s Pause
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
      gain.gain.setValueAtTime(0.12, t + 1);
      gain.gain.linearRampToValueAtTime(0, t + 1.03);
      t += 3;
    }
    return { stop() { try { gain.gain.cancelScheduledValues(0); gain.gain.value = 0; o1.stop(); o2.stop(); gain.disconnect(); } catch (_) {} } };
  }

  function hangupTone() {
    if (!audioCtx) return;
    const ctx = audioCtx, g = ctx.createGain(), o = ctx.createOscillator();
    o.frequency.value = 425; o.connect(g); g.connect(ctx.destination);
    let t = ctx.currentTime;
    g.gain.value = 0;
    for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(0.1, t); g.gain.setValueAtTime(0, t + 0.2); t += 0.4; }
    o.start(); o.stop(t);
  }

  // ------------------------------------------------------------------ Bildschirm wach halten
  let wakeLock = null;
  async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (_) {} }
  function releaseWakeLock() { try { wakeLock?.release(); } catch (_) {} wakeLock = null; }

  // Doppeltipp-Zoom & Kontextmenü verhindern (Kiosk)
  document.addEventListener("dblclick", (e) => e.preventDefault());
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  init();
})();
