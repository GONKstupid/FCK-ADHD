# Spec: FCK-ADHD

**Status:** Entwurf v1 – Ergebnis eines Brainstormings
**Ziel-Plattform (MVP):** Android (hybrid PWA via Capacitor)
**Ziel-Plattform (später):** iOS, mit eingeschränkter Funktionalität

---

## 1. Überblick & Motivation

Ein persönliches Sicherheits-Tool, das per QR-Code-Scan ausgelöst wird und den Nutzer zuverlässig – notfalls aufdringlich – daran erinnert, sicherheitskritische Handlungen im Haushalt nicht zu vergessen (z. B. den Herd auszuschalten). Erinnerungen müssen so aufdringlich sein, dass sie nicht versehentlich überhört oder achtlos weggeklickt werden können.

**Leitbeispiel (MVP-Routine „Kochen“):**
1. Nutzer scannt QR-Code in der Küche → sofortiger Hinweis: „Dunstabzugshaube anmachen“ (reine Info, keine Bestätigung nötig).
2. 30 Minuten später (konfigurierbar): Vollbild-Erinnerung „Herd ausmachen“, blockiert das Gerät vollständig, unterbricht laufende Musik/Audio.
3. Reagiert der Nutzer nicht, wiederholt sich die Erinnerung alle 1 Minute – endlos – bis der QR-Code erneut gescannt wird.
4. Der Nutzer kann die Frist stattdessen über einen bewusst aufwendigen Prozess verlängern (max. 3×).
5. Ab der 3. unbeantworteten 1-Minuten-Wiederholung kommt zusätzlich ein frei wählbarer Klingelton als Eskalation dazu.

---

## 2. Zustandsautomat (pro aktiver Routinen-Instanz)

```
IDLE
  │  QR-Scan (Routine nicht aktiv)
  ▼
STEP_1_HINWEIS  ──(sofort)──▶  WAITING (Timer läuft, z.B. 30 Min)
                                    │
                     ┌──────────────┼───────────────┐
                     │ QR-Scan            Timer abgelaufen
                     ▼                              ▼
                   IDLE                        REMINDING (1-Min-Loop)
                                                     │
                     ┌───────────────┬──────────────┼─────────────┐
                     │ QR-Scan       │ Verlängerung  │ 3. Loop ohne
                     ▼               │ (falls < 3x)  │ Reaktion
                   IDLE               ▼                ▼
                              WAITING (neue Frist)  REMINDING + Klingelton
                                                       (läuft weiter bis Scan)
```

Wichtig: Ein QR-Scan während `WAITING` oder `REMINDING` beendet die aktive Instanz sofort (Nutzer war schneller fertig / hat reagiert) und geht zurück zu `IDLE`.

---

## 3. Funktionale Anforderungen

### 3.1 Routinen & Schritte
- **MVP:** eine fest hinterlegte Routine („Herd/Dunstabzugshaube“) mit 2 Schritten.
- **Architektur:** Datenmodell ist von Anfang an generisch (siehe Abschnitt 4), sodass später beliebig viele, frei konfigurierbare Routinen mit beliebig vielen Schritten ergänzt werden können, ohne die Kernlogik neu zu bauen.
- Jeder Schritt hat: Label, Verzögerung, ob Wiederholung aktiv ist, Wiederholungsintervall, Verlängerungs- und Eskalationsregeln.

### 3.2 QR-Codes
- Die App generiert eigene, eindeutige QR-Codes pro Routine (zum Ausdrucken/Aufkleben, z. B. an der Dunstabzugshaube).
- Scan-Verhalten:
  - Keine aktive Instanz dieser Routine → startet neue Instanz (Schritt 1 sofort, Timer für Schritt 2 startet).
  - Aktive Instanz vorhanden → Scan bestätigt/beendet die Instanz sofort, unabhängig davon, ob gerade `WAITING` oder `REMINDING` aktiv ist.
  - Mehrfach-Scans innerhalb von ca. 2 Sekunden werden entprellt (Debounce), um Doppel-Starts/-Stopps zu vermeiden.

### 3.3 Erinnerung & Blockierung (Kernfeature)
- Erinnerungen erscheinen als **Vollbild-Overlay über allen anderen Apps und über dem Sperrbildschirm** (technisch analog zu Wecker-/Anruf-Apps: Full-Screen-Intent-Notification + Foreground-Service auf Android).
- Alle Audioausgabe anderer Apps wird unterbrochen, indem exklusiver Audiofokus angefordert wird (`AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE`); die meisten Apps (YouTube Music, Spotify etc.) pausieren dadurch automatisch.
- Der eigene Erinnerungston läuft über den Alarm-Audiokanal (`STREAM_ALARM`), damit er auch bei aktiviertem Lautlos-Modus hörbar bleibt.
- Schritt 1 („Dunstabzugshaube an“) ist ein einmaliger Hinweis ohne Bestätigungspflicht – der Timer für Schritt 2 läuft unabhängig davon sofort ab dem initialen Scan.

### 3.4 Verlängerungs-Mechanismus
- Erreichbar nur während einer aktiven Erinnerung (`WAITING`-Ablauf oder `REMINDING`-Loop).
- Bewusst mehrstufig und aufwendig, damit er nicht versehentlich/reflexartig weggeklickt werden kann:
  1. Rechenaufgabe lösen (z. B. einfache, aber nicht triviale Kopfrechnung, zufällig generiert).
  2. Danach: Slider für eine definierte Mindestdauer ununterbrochen halten (z. B. 3–5 Sekunden), erst danach wird die Verlängerung wirksam.
- Verlängerungsdauer: frei wählbar über Slider (5–60 Minuten).
- Maximal **3 Verlängerungen** pro Instanz. Danach ist nur noch die endlose 1-Minuten-Wiederholung bis zum erneuten Scan möglich (keine weitere Verlängerungsoption mehr verfügbar/anzeigt).

### 3.5 Eskalation
- Ab der 3. unbeantworteten Wiederholung des 1-Minuten-Loops (also ab Minute 3 im `REMINDING`-Zustand) wird zusätzlich ein **frei in den Einstellungen wählbarer Klingelton** abgespielt – additiv zum bisherigen Overlay + Ton, nicht als Ersatz.

### 3.6 Zuverlässigkeit im Hintergrund (kritisch!)
Das ist der wichtigste technische Punkt, weil davon die gesamte Sicherheitsfunktion abhängt:
- Timer dürfen **nicht** als einfache JavaScript-`setTimeout`-Aufrufe umgesetzt werden – diese überleben ein App-Kill durch Android (z. B. bei Speicherdruck oder Doze-Modus) nicht.
- Stattdessen: exakte, nativ geplante Alarme (`AlarmManager.setExactAndAllowWhileIdle` bzw. `setAlarmClock`), die auch bei geschlossener App zuverlässig auslösen.
- Beim ersten Einrichten fragt die App aktiv nach der Berechtigung, die Akku-Optimierung für sie zu deaktivieren („Ignore battery optimizations“), da Android sonst geplante Alarme verzögern kann.
- Laufender Instanz-Status (aktueller Schritt, Deadline, genutzte Verlängerungen) wird persistiert, damit er auch nach einem App- oder Geräte-Neustart korrekt wiederhergestellt wird.

---

## 4. Datenmodell (vereinfacht, TypeScript-Notation)

```typescript
interface Routine {
  id: string;              // UUID
  name: string;             // z.B. "Herd/Dunstabzugshaube"
  qrCodeId: string;         // im QR-Code kodierter eindeutiger Wert
  steps: Step[];
  createdAt: string;
  updatedAt: string;
}

interface Step {
  id: string;
  order: number;
  label: string;                     // z.B. "Herd ausmachen"
  type: "instant_hint" | "delayed_reminder";
  delayMinutes?: number;             // z.B. 30 (nur bei delayed_reminder)
  repeatIntervalMinutes?: number;    // z.B. 1
  extension?: {
    enabled: boolean;
    maxCount: number;                // z.B. 3
    durationMinutesRange: [number, number]; // z.B. [5, 60]
  };
  escalation?: {
    enabled: boolean;
    triggerAfterRepeats: number;     // z.B. 3
    ringtoneId: string;              // vom Nutzer gewählt
  };
}

interface RoutineInstance {
  id: string;
  routineId: string;
  currentStepId: string;
  state: "waiting" | "reminding" | "idle";
  deadline: string;          // ISO-Timestamp
  extensionsUsed: number;
  repeatCount: number;       // Anzahl bisheriger 1-Min-Wiederholungen
  startedAt: string;
}
```

---

## 5. Technischer Stack (Vorschlag)

| Bereich | Wahl | Begründung |
|---|---|---|
| Frontend | React + TypeScript + Vite | Große Community, gute Capacitor-Integration |
| Hybrid-Wrapper | Capacitor (Android-Target zuerst) | Ermöglicht native Berechtigungen bei weitgehend geteiltem Web-Code |
| Lokale Speicherung | Capacitor Preferences (Einstellungen) + IndexedDB via Dexie.js (Routinen/Instanzen) | Rein lokal, kein Server nötig |
| QR-Code-Erstellung | npm-Paket `qrcode` | Einfache Generierung als SVG/PNG zum Drucken |
| QR-Code-Scan | `@capacitor-mlkit/barcode-scanning` | Aktiv gepflegt, ML-Kit-basiert, zuverlässig |
| Vollbild-Alarm/Overlay | Custom natives Android-Plugin (Kotlin): Full-Screen-Intent + Foreground-Service | Kein Standard-Capacitor-Plugin deckt das vollständig ab – größter Entwicklungsaufwand im Projekt |
| Exaktes Timing | `AlarmManager.setExactAndAllowWhileIdle` über dasselbe native Plugin | Überlebt App-Kill/Doze-Modus |
| Audio | Natives `AudioManager` – `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE` + `STREAM_ALARM` | Pausiert andere Apps, umgeht Lautlos-Modus |

Benötigte Android-Berechtigungen (u. a.): `POST_NOTIFICATIONS`, `USE_FULL_SCREEN_INTENT`, `SCHEDULE_EXACT_ALARM`, `CAMERA`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.

---

## 6. Bekannte Einschränkungen & Risiken

- **iOS:** Apple erlaubt regulären Apps kein echtes „Overlay über anderen Apps“. Volle Blockier-Funktion ist auf iOS praktisch nicht umsetzbar; ein späterer iOS-Support würde nur mit deutlich reduzierter Funktionalität (laute kritische Benachrichtigung statt echtem Overlay) möglich sein.
- **Audio-Unterbrechung:** Funktioniert nur bei Apps, die sich an Androids Audiofokus-Regeln halten – trifft auf praktisch alle gängigen Apps zu, ist aber keine 100 %ige Garantie für jede denkbare App.
- **Custom natives Plugin nötig:** Der Kern der Blockier- und Timing-Logik lässt sich nicht mit Standard-Capacitor-Plugins abdecken, sondern erfordert eigene native Android-Entwicklung (Kotlin). Das ist der aufwendigste Teil der Umsetzung.
- **Android-Versionsunterschiede:** Ab Android 14 gibt es zusätzliche Einschränkungen für Full-Screen-Intents, die ggf. eine explizite Nutzerfreigabe erfordern (ähnlich wie bei Wecker-Apps).

---

## 7. Angenommene Defaults (bestätigt)

Diese Punkte wurden nicht explizit abgefragt, aber vom Nutzer als sinnvoll bestätigt:

- Ein Scan **während** der `WAITING`-Phase (bevor der 30-Min-Timer überhaupt abgelaufen ist) beendet die Instanz sofort – falls der Nutzer schneller fertig ist als geplant.
- Ein Scan eines fremden/falschen QR-Codes während eine andere Routine aktiv läuft, hat keine Auswirkung auf die laufende Instanz.
- Für das MVP läuft zu jedem Zeitpunkt maximal eine Routinen-Instanz gleichzeitig (Konfliktbehandlung bei mehreren parallelen Routinen ist erst ab Multi-Routinen-Ausbau relevant).

---

## 8. Roadmap (Phasen)

| Phase | Ziel | Wichtigste Schritte |
|---|---|---|
| 0 – Setup | Projektgerüst steht | Capacitor + React + Vite aufsetzen, Android-Zielplattform hinzufügen, Grundnavigation/leere Screens |
| 1 – Datenmodell & Kernlogik | Zustandsautomat funktioniert (ohne native Blockierung) | Routine/Step/Instance-Modell umsetzen, lokale Speicherung (IndexedDB/Dexie + Preferences), Zustandsautomat aus Abschnitt 2 als reine JS-Logik testen (z. B. erstmal mit normalen Notifications statt Vollbild) |
| 2 – QR-Code-Flow | Scan startet/beendet Instanzen zuverlässig | QR-Code-Generierung (Routine anlegen → Code erzeugen/drucken), In-App-Scanner integrieren, Debounce-Logik |
| 3 – Natives Blockier-Plugin | Vollbild-Overlay + Audio-Unterbrechung funktionieren | Custom Android-Plugin (Kotlin): Full-Screen-Intent, Foreground-Service, AudioFocus-Anfrage, STREAM_ALARM |
| 4 – Zuverlässigkeit im Hintergrund | Timer überleben App-Kill/Doze/Neustart | AlarmManager exact alarms integrieren, Battery-Optimierung-Onboarding, State-Persistenz & Wiederherstellung nach Neustart |
| 5 – Verlängerung & Eskalation | Kompletter Ablauf inkl. Rätsel/Slider und Klingelton | Rechenaufgabe-UI, Slider-Halten-Mechanik, Verlängerungs-Limit (max. 3), Eskalations-Klingelton ab 3. Wiederholung |
| 6 – Härtungstest | App hält auch unter realen Bedingungen | Tests auf echtem Gerät über mehrere Stunden/Tage, verschiedene Android-Versionen, Edge Cases (Doppel-Scan, Neustart während Timer, Akku leer etc.) |
| 7 – Polish & persönlicher Release | Nutzbar im Alltag | Onboarding-Flow (Berechtigungen erklären), UI-Feinschliff, App-Icon, als APK für privates Sideloading bauen |
| Später (v2+) | Erweiterungen | Mehrere freie Routinen, iOS-Unterstützung, Cloud-Backup, Notfallkontakt-Benachrichtigung |

---

## 9. UI Design-Konzept

**Inspiration:** reduziertes, technisches Look & Feel wie bei Nothing OS/Nothing X (Punktraster-Typografie, sichtbare „Mechanik“, Schwarz/Weiß + ein Akzentton) – bewusst neu interpretiert statt kopiert, und ausschließlich mit Open-Source-Bausteinen umgesetzt. Ein visuelles Mockup der drei Kern-Screens liegt als separate Datei bei (`fck-adhd-ui-konzept.html`).

**Hinweis zu Open Source:** Nothings eigene Punkt-Schrift „Ndot“ ist proprietär und nur für Nothing-Produkte lizenziert – sie wird hier **nicht** verwendet. Stattdessen kommen offene, unter der SIL Open Font License stehende Google-Fonts-Schriften mit ähnlichem Dot-Matrix-Charakter zum Einsatz.

### Typografie
| Verwendung | Schrift | Lizenz |
|---|---|---|
| Zahlen/Timer/Zähler (Dot-Matrix-Look) | DotGothic16 (Google Fonts) | SIL Open Font License |
| Fließtext/Labels/UI | JetBrains Mono (Google Fonts) | SIL Open Font License |

*(Lizenzstatus vor Produktivnutzung selbst nochmal verifizieren.)*

### Farbpalette
| Rolle | Farbe |
|---|---|
| Hintergrund (Ruhezustand) | Off-White `#F5F3EC` |
| Hintergrund (Alarmzustand) | Fast-Schwarz `#0D0D0C` |
| Text/Primär | `#1B1B1A` / `#F5F3EC` (je nach Zustand) |
| Akzent (nur aktive Alarme) | Rot `#FF3B30` |
| Rahmen/Sekundär | Grau `#CFCBBE` |

### Gestaltungsprinzipien
- **Ein Akzent, konsequent:** Rot erscheint ausschließlich bei aktiven Alarmen/kritischen Aktionen, nie dekorativ – die Bedeutung bleibt eindeutig.
- **Glyph-Streifen als Signatur-Element:** ein Punktraster-Statusstreifen oben auf jedem Screen (angelehnt an Nothings Glyph-Interface), der den tatsächlichen Zustand codiert – aus, gedimmt, pulsierend rot – statt nur zu dekorieren.
- **Bestätigen ist die einfache Option:** Im Alarmzustand ist der große, primäre Button immer „bestätigen“ (QR scannen); „Verlängern“ ist bewusst klein und zurückhaltend platziert.
- **Harter Kontrast im Alarmfall:** Der Vollbild-Reminder kehrt bewusst ins Negative (dunkler Hintergrund), um sich klar vom ruhigen, hellen Grundzustand abzuheben.

### Screens (Konzept)
1. **Dashboard** – Routinen-Übersicht, Status-Pille, Dot-Matrix-Uhr
2. **Vollbild-Alarm** – dominanter dunkler Zustand, Dot-Matrix-Zähler der Wiederholungen, primäre Aktion „bestätigen“
3. **Verlängerung** – zweistufiger Flow: Rechenaufgabe → Halten-Geste

---

## 10. Out of Scope für v1 (bewusst zurückgestellt)

- Mehrere gleichzeitig aktive Routinen inkl. Konfliktbehandlung
- Voller iOS-Support
- Cloud-Backup/-Sync
- Benachrichtigung einer Notfall-Kontaktperson bei ausbleibender Reaktion
- Eigene Sound-Uploads für den Eskalations-Klingelton (v1: Auswahl aus mitgelieferten Tönen)
