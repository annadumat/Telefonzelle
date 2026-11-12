# Telefonzelle – Anruf in die Zukunft

Eine Website, die einen (Video-)Anruf mit einem Avatar aus der Zukunft simuliert.

```
[Anrufen] → Klingeln → Video 1 (Begrüßung + Frage 1) → du sprichst (Aufnahme)
          → Video 2 (Reaktion + Frage 2) → du sprichst (Aufnahme)
          → Video 3 (Verabschiedung) → "Anruf beendet" → zurück zum Start
```

Auflegen geht jederzeit (roter Knopf). Eine angefangene Aufnahme wird dann als
`…_abgebrochen` gespeichert.

Es gibt zwei Betriebsarten, die Seite erkennt automatisch, welche gerade gilt:

| | **Nur iPad** (empfohlen, wenig Hardware) | **Mit Laptop-Server** |
|---|---|---|
| Geräte | nur das iPad | iPad + Laptop (oder nur Laptop) |
| Internet | nur einmal zum Einrichten / Aktualisieren | nie |
| Aufnahmen liegen | auf dem iPad, Export per AirDrop / Dateien-App | direkt als Dateien auf dem Laptop |

---

## Variante 1: Nur iPad (offline, ohne Laptop)

Die Seite wird **einmal** über eine HTTPS-Adresse geladen und als App auf den
Home-Bildschirm gelegt. Danach sind Seite und Videos auf dem iPad gespeichert und alles
läuft ohne Internet. Die Aufnahmen bleiben auf dem iPad, bis du sie exportierst.

### Einrichten (einmalig, mit Internet)

1. **Seite veröffentlichen.** Zwei Möglichkeiten:
   - **GitHub Pages:** Im Repo unter *Settings → Pages → Source* „GitHub Actions“ wählen.
     Bei jedem Push auf `main` wird der Ordner `public/` automatisch veröffentlicht
     (Workflow `.github/workflows/pages.yml`). Für private Repos braucht GitHub Pages
     einen bezahlten Plan.
   - **Netlify Drop:** https://app.netlify.com/drop öffnen und den Ordner `public/`
     hineinziehen (kostenloses Konto anlegen, sonst wird die Seite nach kurzer Zeit wieder
     gelöscht).

   ⚠️ Die Videos sind dann für jeden mit dem Link abrufbar (die Aufnahmen **nicht**, die
   verlassen das iPad nie).
2. Auf dem iPad die Adresse in **Safari** öffnen → Teilen → **„Zum Home-Bildschirm“**.
3. Die App vom Home-Bildschirm starten (nicht in Safari, die beiden haben getrennte
   Speicher!) und einmal einen Testanruf machen → Mikrofon erlauben.
4. Export-Seite öffnen (siehe unten) und prüfen: **„offline bereit: ja“**.
5. Ab jetzt kann das WLAN aus sein.

### Aufnahmen exportieren

- Auf dem Startbildschirm **5× schnell auf die Uhrzeit oben tippen** → Export-Seite
  (PIN: `2036`, änderbar in `config.json` → `adminPin`).
- **„Neue exportieren“** → **„Teilen / AirDrop / In Dateien sichern“**. Du bekommst eine
  ZIP-Datei mit einem Ordner pro Anruf (Aufnahmen + `anruf.json`).
- Danach sind die Aufnahmen als *exportiert* markiert. **„Exportierte löschen“** gibt
  den Speicher wieder frei. Ohne diesen Schritt wird nie etwas gelöscht.
- Einzelne Aufnahmen kann man dort auch direkt anhören und einzeln teilen.

**Tipp:** Exportiere regelmäßig (z. B. jeden Abend). Solange die Aufnahmen nur auf dem
iPad liegen, gehen sie verloren, wenn die Home-Bildschirm-App gelöscht wird oder unter
*Einstellungen → Safari → Websitedaten* die Daten entfernt werden.

### Videos oder Texte ändern

Dateien in `public/` austauschen, neu veröffentlichen, dann auf dem iPad (mit Internet)
in der Export-Seite **„Videos & Seite neu laden“** tippen.

---

## Variante 2: Mit Laptop-Server

Nur Python 3 nötig, keine Installation, kein Internet.

**Laptop ist selbst das Gerät:**

```bash
python3 server.py
```

Dann `http://localhost:8000` öffnen.

**iPad / Handy als Gerät, Laptop als Server** (selbes WLAN, z. B. Hotspot des Laptops):

```bash
python3 server.py --https
```

Auf dem iPad die angezeigte `https://…:8443`-Adresse öffnen, die Zertifikatswarnung
bestätigen („Details einblenden“ → „Diese Website besuchen“) und das Mikrofon erlauben.
HTTPS ist nötig, weil Browser das Mikrofon sonst sperren. Das Zertifikat wird
automatisch in `./cert` erzeugt. Ändert sich die IP des Laptops, den Ordner löschen.

Aufnahmen landen dann direkt auf dem Laptop:

```
recordings/2026-11-03_14-05-22/
  01_antwort.m4a      ← Original aus dem Browser (.m4a/.mp4 bei Safari, .webm bei Chrome)
  01_antwort.mp3      ← überall abspielbare Kopie (wenn ffmpeg installiert ist)
  anruf.json          ← Zeitstempel, Dauer, aufgelegt ja/nein …
```

Abschalten der MP3/MP4-Kopien: `python3 server.py --ohne-konvertierung`.
Auf der Export-Seite (5× auf die Uhr tippen) kann man die Aufnahmen vom Laptop außerdem
direkt anhören und herunterladen.
Fällt der Server während eines Anrufs aus, speichert die Seite auf dem Gerät
(Export dann wie in Variante 1).

---

## Eigene Videos einsetzen

Videos nach `public/videos/` legen und in `public/config.json` eintragen. Aktuell sind die
vier Melo-Videos `01_melo.mp4` bis `04_melo.mp4` eingetragen. Fehlt eine Datei, zeigt die Seite einen
Platzhalter-Bildschirm mit Countdown.

Empfohlenes Format: **MP4, H.264 + AAC**, möglichst klein (720p reicht auf dem iPad):

```bash
ffmpeg -i mein_video.mov -vf scale=-2:720 -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart public/videos/01_begruessung_frage1.mp4
```

Tipps:
- Am Ende jedes Fragevideos 1–2 s „zuhören“ lassen (leicht nicken), denn das letzte
  Bild bleibt während der Aufnahme stehen.
- Die Videos sind vorproduziert, also die „Reaktionen“ allgemein formulieren
  („Spannend, dass du das so siehst …“).

## config.json

| Feld | Bedeutung |
|---|---|
| `jahr` | Jahreszahl neben der Uhr auf dem Startbildschirm |
| `anrufer.name / untertitel / bild` | Anzeige auf Start- und Anrufbildschirm |
| `aufnahme` | `"audio"` (nur Ton) oder `"video"` (Kamera + Ton, mit Selbstansicht) |
| `speichern` | `"auto"` (Server wenn vorhanden, sonst Gerät), `"geraet"` oder `"server"` |
| `adminPin` | PIN für die Export-Seite (`""` = keine PIN) |
| `verbindungston` | `"aus"` (still), `"rauschen"` (Funk-Rauschen) oder `"klingeln"` (Freizeichen) beim Verbindungsaufbau |
| `verbindenSekunden` | Dauer des Verbindungsbildschirms, bevor Melo startet |
| `klingelnSekunden` | wie lange es vor dem „Abnehmen“ klingelt (alternativ `klingelnAnzahl` für eine feste Zahl an Klingeltönen) |
| `platzhalterSekunden` | Dauer des Platzhalters, wenn ein Video fehlt |
| `sprechen.stilleBeendetNachMs` | so lange Stille nach dem Sprechen → Aufnahme endet; `0` = aus, dann nur per Knopf „Fertig gesprochen“ |
| `sprechen.maxDauerMs` | maximale Länge einer Antwort in ms; `0` = unbegrenzt |
| `sprechen.keineSpracheAbbruchMs` | sagt jemand gar nichts, geht es nach dieser Zeit (ms) weiter; `0` = aus |
| `sprechen.lautstaerkeSchwelle` | ab welchem Pegel „Sprechen“ erkannt wird (passt sich zusätzlich ans Grundrauschen an) |
| `mikrofonDauerhaftOffen` | `true`: Mikrofon bleibt nach dem ersten Erlauben offen, damit das iPad nicht bei jedem Anruf neu fragt (aufgenommen wird nur in den Sprechphasen) |
| `mikrofonNurBeimSprechen` | `true`, falls auf iPhones der Videoton bei aktivem Mikrofon zu leise wird |
| `standbildDatei` | festes Bild für das runde Standbild während man spricht (z. B. `melo.jpg`); leer lassen = automatisch aus dem Video |
| `standbild` | Ausschnitt für das runde Standbild während man spricht: `mitteX` (horizontale Mitte des Kopfes, 0–1), `obenY` (oberer Rand, 0–1), `groesse` (Anteil der Videohöhe) |
| `ablauf` | Liste der Videos; `danachAufnehmen: true` = danach darf gesprochen werden; `frage` = Text, der während der Aufnahme eingeblendet wird (nach jedem „?“ beginnt automatisch ein neuer Absatz) |

Für mehr Fragen einfach weitere Einträge in `ablauf` ergänzen. Den Knopf
**„Fertig gesprochen“** gibt es immer zusätzlich.

## Ausstellungsbetrieb (iPad)

- **Geführter Zugriff** (Einstellungen → Bedienungshilfen) sperrt das iPad auf die App.
  Für den Export kurz beenden (3× Seitentaste).
- Automatische Sperre aus, Lautstärke hoch, ggf. Kopfhörer oder Telefonhörer mit Mikrofon.
- iPad am Strom lassen.

## Dateien

```
public/            die Website (wird veröffentlicht bzw. von server.py ausgeliefert)
  index.html, style.css, app.js   Anruf
  admin.html, admin.js            Export-Seite
  storage.js                      Speichern auf dem Gerät + ZIP
  sw.js, manifest.webmanifest     Offline-Betrieb / Home-Bildschirm-App
  config.json                     Ablauf & Einstellungen
  videos/                         Avatar-Videos
server.py          optionaler Laptop-Server (Python-Standardbibliothek)
```
