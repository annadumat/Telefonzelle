# Telefonzelle – Anruf in die Zukunft

Eine lokale Website, die einen (Video-)Anruf mit einem Avatar aus der Zukunft simuliert.
Läuft **komplett offline** – nötig ist nur Python 3 auf einem Laptop.

```
[Anrufen] → Klingeln → Video 1 (Begrüßung + Frage 1) → du sprichst (Aufnahme)
          → Video 2 (Reaktion + Frage 2) → du sprichst (Aufnahme)
          → Video 3 (Verabschiedung) → "Anruf beendet" → zurück zum Start
```

Auflegen ist jederzeit möglich (roter Knopf). Eine angefangene Aufnahme wird dann als
`…_abgebrochen` gespeichert.

## Starten

**A) Laptop ist selbst das Gerät** (Browser auf demselben Rechner):

```bash
python3 server.py
```

Dann `http://localhost:8000` öffnen (am besten Chrome oder Safari, Vollbild mit F11 bzw. ⌃⌘F).

**B) iPad / Handy als Gerät, Laptop als Server** (beide im selben WLAN – das WLAN braucht
keinen Internetzugang, ein Router oder der Hotspot des Laptops reicht):

```bash
python3 server.py --https
```

Auf dem iPad die angezeigte Adresse öffnen, z. B. `https://192.168.1.23:8443`.
Beim ersten Mal kommt eine Zertifikatswarnung → „Details einblenden“ → „Diese Website besuchen“.
Danach Mikrofon (bzw. Kamera) erlauben.

> Warum HTTPS? Browser geben Mikrofon/Kamera nur auf sicheren Seiten frei. `localhost` gilt
> als sicher, eine WLAN-IP nur mit HTTPS. Das Zertifikat wird automatisch in `./cert` erzeugt
> (braucht `openssl`, auf macOS/Linux vorinstalliert). Ändert sich die IP des Laptops, einfach
> den Ordner `cert` löschen und neu starten.

### Tipps für den Ausstellungsbetrieb (iPad)
- Seite in Safari öffnen → Teilen → **„Zum Home-Bildschirm“** → startet ohne Adressleiste.
- **Geführter Zugriff** (Einstellungen → Bedienungshilfen) sperrt das iPad auf diese App.
- Automatische Sperre ausschalten, Lautstärke hoch, ggf. externes Mikrofon/Kopfhörer.

## Eigene Videos einsetzen

Videos in den Ordner `videos/` legen und in `public/config.json` eintragen. Die mitgelieferten
Dateien sind nur Platzhalter. Fehlt eine Datei, zeigt die Seite automatisch einen
Platzhalter-Bildschirm mit Countdown – der Ablauf funktioniert also auch ohne Videos.

Empfohlenes Format (läuft auf iPad, Handy und Laptop): **MP4, H.264 + AAC**.
Mit ffmpeg umwandeln:

```bash
ffmpeg -i mein_video.mov -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart videos/01_begruessung_frage1.mp4
```

Tipp: Lass den Avatar am Ende jedes Fragevideos 1–2 s „zuhören“ (leicht nicken), dann wirkt
der Übergang zur Aufnahme natürlich – das letzte Bild bleibt während der Aufnahme stehen.
Da die Videos vorproduziert sind, sollten die „Reaktionen“ allgemein formuliert sein
(„Spannend, dass du das so siehst …“).

## config.json

| Feld | Bedeutung |
|---|---|
| `anrufer.name / untertitel / bild` | Anzeige auf Start- und Anrufbildschirm |
| `aufnahme` | `"audio"` (nur Ton) oder `"video"` (Kamera + Ton, mit Selbstansicht) |
| `klingelnSekunden` | wie lange es vor dem „Abnehmen“ klingelt |
| `platzhalterSekunden` | Dauer des Platzhalters, wenn ein Video fehlt |
| `sprechen.stilleBeendetNachMs` | so lange Stille nach dem Sprechen → Aufnahme endet automatisch |
| `sprechen.maxDauerMs` | maximale Länge einer Antwort |
| `sprechen.keineSpracheAbbruchMs` | sagt jemand gar nichts, geht es nach dieser Zeit weiter |
| `sprechen.lautstaerkeSchwelle` | ab welchem Pegel als „Sprechen“ erkannt wird (passt sich zusätzlich ans Grundrauschen an) |
| `mikrofonNurBeimSprechen` | `true`, falls auf iPhones der Videoton bei aktivem Mikrofon zu leise wird |
| `ablauf` | Liste der Videos; `danachAufnehmen: true` = nach diesem Video darf gesprochen werden |

Mehr Fragen? Einfach weitere Einträge in `ablauf` ergänzen.
Zusätzlich gibt es immer den Knopf **„Fertig gesprochen“**.

## Wo landen die Aufnahmen?

```
recordings/
  2026-11-03_14-05-22/          ← ein Ordner pro Anruf
    01_antwort.m4a              ← Original aus dem Browser
    01_antwort.mp3              ← überall abspielbare Kopie (wenn ffmpeg installiert ist)
    02_antwort.m4a
    02_antwort.mp3
    anruf.json                  ← Zeitstempel, Dauer, aufgelegt ja/nein, Grund fürs Aufnahmeende
```

Je nach Browser ist das Original `.m4a`/`.mp4` (Safari) oder `.webm` (Chrome).
Ist **ffmpeg** auf dem Laptop installiert (`brew install ffmpeg` / `apt install ffmpeg`),
legt der Server automatisch eine MP3 (Audio) bzw. H.264-MP4 (Video) daneben.
Abschalten mit `python3 server.py --ohne-konvertierung`.

Kann der Server mal nicht erreicht werden, versucht die Seite es mehrmals erneut und lädt die
Datei notfalls direkt auf dem Gerät herunter.

## Dateien

```
server.py          lokaler Server (Python-Standardbibliothek, keine Installation)
public/            Website (index.html, style.css, app.js, config.json, avatar.svg)
videos/            Avatar-Videos (aktuell Platzhalter)
recordings/        Aufnahmen (wird automatisch angelegt, nicht im Git)
```
