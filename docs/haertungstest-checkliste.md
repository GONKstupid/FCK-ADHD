# Härtungstest-Checkliste – FCK-ADHD (Phase 6)

> Manuelles Device-Testprotokoll für die Zuverlässigkeitsprüfung auf echten Geräten.
> Grundlage: `spec-FCK-ADHD-erinnerung-app.md` (§1, §3.4–3.6, §8 Phase 6).

---

## 1. Kopf

| Feld | Wert |
|---|---|
| **Zweck** | Nachweis, dass die Alarmkette (Exact Alarm → Foreground Service → Vollbild-Overlay → STREAM_ALARM) unter realen Bedingungen zuverlässig funktioniert: App-Kill, Neustart, Doze, Lautlos, widerrufene Berechtigungen, leerer Akku. |
| **App-Version** | `____________` (Build-/Commit-Hash) |
| **Datum** | `____________` |
| **Tester:in** | `____________` |
| **Gerät(e)** | `____________` |

**Legende:** `OK` = Verhalten wie erwartet · `FEHLER` = Abweichung → Details im Abschnitt „Beobachtungen/Notizen“ am Ende dokumentieren.

---

## 2. Aufbau & Build-Zyklus

### 2.1 Build & Installation (PowerShell)

Jede Testrunde mit einem **frischen Build** beginnen:

```powershell
# 1. Web-Bundle bauen
npm run build

# 2. Web-Assets in den Android-Ordner synchronisieren
npx cap sync android

# 3. Debug-APK auf das angeschlossene Gerät installieren
cd android
.\gradlew.bat installDebug

# Zurück ins Projektverzeichnis
cd ..
```

> Hinweis: In PowerShell `;` statt `&&` verwenden, wenn Befehle verkettet werden sollen.
> Alternativ: `npx cap run android` nach dem Sync.

### 2.2 Vor Teststart prüfen (Pflicht)

- [ ] App ist installiert und startet (`com.gonkstupid.fckadhd`).
- [ ] **Akku-Optimierungs-Ausnahme gesetzt:** Einstellungen → Apps → FCK-ADHD → Akku → „Nicht optimiert“ (die App fragt beim Onboarding aktiv danach – `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).
- [ ] **Berechtigungen erteilt:**
  - [ ] Benachrichtigungen (`POST_NOTIFICATIONS`)
  - [ ] Kamera (`CAMERA`)
  - [ ] Exakte Alarme (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`)
  - [ ] Vollbild-Benachrichtigungen (`USE_FULL_SCREEN_INTENT`, ab Android 14 separat prüfen, siehe S13)
- [ ] QR-Code der MVP-Routine („Herd/Dunstabzugshaube“) ist ausgedruckt/auf dem Zweitdisplay verfügbar.
- [ ] Test-Timer auf kurze Verzögerung stellen (falls konfigurierbar), sonst reale Wartezeiten einplanen.
- [ ] `adb`-Verbindung steht: `adb devices` zeigt das Gerät.

### 2.3 Ausführungshinweis (Schnelldurchlauf)

**Build & Installation** (Details siehe §2.1) – Gradle benötigt **JDK 21** (`JAVA_HOME` muss auf ein JDK 21 zeigen):

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
npm run build; npx cap sync android; cd android; .\gradlew.bat installDebug; cd ..
```

**Empfohlene Reihenfolge:** S1–S14 fortlaufend, mit dieser Gruppierung:

1. **Scan-Basics:** S1, S2 (schnell, ohne Wartezeiten).
2. **Alarm-Kern:** S3, S4, S5, S6 (bauen aufeinander auf).
3. **Robustheit:** S7, S8, S9, S11 (App-Kill, Neustarts, Doze).
4. **Umgebung:** S12 (Lautlos/DND), S14 (Lockscreen).
5. **Sonderfälle zuletzt:** S10 (Akku leer – zeitaufwendig), S13 (Berechtigungen entziehen; danach wieder erteilen).

**Benötigte Geräte:** mindestens 1× Android 12+ (API 31+) und 1× Android 14+ (API 34+) – Eintrag in der Device-Matrix (§3) nicht vergessen.

**Bestehens-Kriterien:** Alle Szenarien auf beiden Geräten „OK“ → siehe **§5 (Bestehens-Kriterium)**.

---

## 3. Device-Matrix

Mindestens diese beiden Zeilen mit echten Geräten abdecken; weitere Geräte ergänzen.

| Gerät | Android-Version | API-Level | Pfad/Besonderheit | OEM-Akkusparmodus-Notiz |
|---|---|---|---|---|
| `____________` | Android 12+ | 31+ | `setAlarmClock`-Pfad; Exakt-Alarm-Berechtigung (`SCHEDULE_EXACT_ALARM`) ist vom Nutzer widerrufbar | z. B. Samsung „Gerätewartung“, Hintergrund-Aktivität erlauben |
| `____________` | Android 14+ | 34+ | `USE_FULL_SCREEN_INTENT` eingeschränkt (Nutzerfreigabe nötig, außer Standard-Wecker-Apps) | z. B. Xiaomi MIUI/HyperOS: Autostart erlauben, sonst killt das System die FGS |
| `____________` | `______` | `____` | `____________` | `____________` |

---

## 4. Testszenarien

Für jedes Szenario gilt: **Beobachtet** ankreuzen, **OK/Fehler** eintragen. Abweichungen im Notizfeld am Ende dokumentieren.

### S1 – Doppel-Scan (Debounce)

**Ziel:** Mehrfach-Scans innerhalb von ca. 2 Sekunden werden entprellt (vgl. §3.2).

- **Vorbereitung:** Keine aktive Instanz; App auf dem Scanner-Screen.
- **Schritte:**
  1. QR-Code scannen (Instanz startet, Schritt-1-Hinweis erscheint).
  2. Innerhalb von **2 Sekunden denselben QR-Code erneut scannen**.
- **Erwartetes Ergebnis:** Der zweite Scan wird **ignoriert** – die Instanz läuft weiter in `WAITING` (Timer aktiv), statt sofort wieder beendet zu werden.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S2 – Scan während WAITING

**Ziel:** Ein Scan in der Warte-Phase beendet die Instanz sofort (vgl. §2, §7).

- **Vorbereitung:** Instanz aktiv, Timer läuft (`WAITING`), Alarm hat noch nicht geklingelt.
- **Schritte:**
  1. QR-Code erneut scannen.
- **Erwartetes Ergebnis:** Der aktuelle Schritt wird **sofort abgeschlossen**; Zustand zurück auf `IDLE`; kein Alarm, kein Klingeln mehr; Dashboard zeigt Routine als inaktiv.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S3 – Timer-Ablauf (Vollbild-Alarm, Audio)

**Ziel:** Kernfunktion aus §3.3: Vollbild über Lockscreen, Alarm-Stream, Audiofokus.

- **Vorbereitung:** Instanz starten; während der Wartezeit eine **Musik-App (z. B. Spotify/YouTube Music) abspielen lassen**; Gerät kann gesperrt werden.
- **Schritte:**
  1. Timer ablaufen lassen (ggf. Gerät vorher sperren).
  2. Verhalten beobachten.
- **Erwartetes Ergebnis:**
  - Vollbild-Alarm erscheint **über allen Apps und dem Sperrbildschirm**.
  - Ton läuft über den **Alarm-Stream (`STREAM_ALARM`)**.
  - Die Musik-App wird **pausiert** (exklusiver Audiofokus `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE`).

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S4 – Endlose Wiederholung

**Ziel:** Der Alarm kehrt alle 60 Sekunden zurück, bis der QR gescannt wird (vgl. §1, §2).

- **Vorbereitung:** Alarm aus S3 aktiv (`REMINDING`).
- **Schritte:**
  1. Alarm wegklicken/dismissen (ohne QR-Scan, ohne Verlängerung).
  2. **60 Sekunden warten.**
  3. Erneut wegklicken und erneut 60 Sekunden warten (mindestens 2 Zyklen).
  4. Abschließend QR-Code scannen.
- **Erwartetes Ergebnis:**
  - Wegklicken stoppt **nur das aktuelle Klingeln**, nicht die Instanz.
  - Nach exakt ca. 60 s **kehrt der Alarm zurück** – beliebig oft.
  - Erst der QR-Scan beendet die Instanz (`IDLE`).

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S5 – Eskalations-Klingelton

**Ziel:** Ab der 3. unbeantworteten Wiederholung spielt zusätzlich der gewählte Eskalations-Klingelton (vgl. §3.5).

- **Vorbereitung:** Eskalations-Klingelton in den Einstellungen gewählt; Instanz im `REMINDING`.
- **Schritte:**
  1. Wiederholung 1 wegklicken → 60 s warten.
  2. Wiederholung 2 wegklicken → 60 s warten.
  3. Wiederholung 3 abwarten und **Ton aufmerksam prüfen**.
- **Erwartetes Ergebnis:** Ab der **3. Wiederholung** ist der Eskalations-Klingelton **zusätzlich** zum bisherigen Alarmton hörbar (additiv, nicht als Ersatz). Vorher nicht.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S6 – Verlängerung (max. 3×)

**Ziel:** Bewusst aufwendiger Verlängerungs-Flow, gedeckelt auf 3× (vgl. §3.4).

- **Vorbereitung:** Instanz im `REMINDING` (aktiver Alarm).
- **Schritte:**
  1. „Verlängern“ öffnen → **Rechenaufgabe** korrekt lösen.
  2. **Halte-Button/Slider** für die Mindestdauer ununterbrochen halten; Dauer wählen (5–60 Min).
  3. Prüfen: neue Frist läuft (`WAITING`), Alarm pausiert bis zur neuen Deadline.
  4. Schritte 1–3 **zwei weitere Male** wiederholen (insgesamt 3 Verlängerungen).
  5. Nach der 3. Verlängerung erneut in den `REMINDING` gehen und Alarm-UI prüfen.
- **Erwartetes Ergebnis:**
  - Verlängerung nur während aktivem Alarm möglich; ohne korrekte Rechenaufgabe/ungehaltene Geste **keine** Verlängerung.
  - Vorzeitiges Loslassen bricht die Verlängerung ab.
  - Nach der **3. Verlängerung ist der Verlängern-Button verschwunden**; nur noch endlose Wiederholung bis Scan möglich.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S7 – App-Kill während WAITING

**Ziel:** Exact Alarm überlebt `force-stop` (vgl. §3.6: kein `setTimeout`).

- **Vorbereitung:** Instanz starten (`WAITING`); kurze Restzeit bis Deadline.
- **Schritte:**
  1. Am PC ausführen:
     ```powershell
     adb shell am force-stop com.gonkstupid.fckadhd
     ```
  2. App **nicht** wieder öffnen; Deadline abwarten.
- **Erwartetes Ergebnis:** Der Alarm **klingelt trotzdem zur Deadline** (Vollbild + Ton).

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S8 – Neustart während WAITING

**Ziel:** `BOOT_COMPLETED` stellt Instanz wieder her und plant Alarm neu (vgl. §3.6).

- **Vorbereitung:** Instanz starten (`WAITING`), Deadline in der Zukunft.
- **Schritte:**
  1. Gerät vollständig neu starten.
  2. Gerät entsperren, App **nicht** öffnen; Deadline abwarten.
- **Erwartetes Ergebnis:** Der Alarm **klingelt zur (neu berechneten) Deadline** wie vor dem Neustart geplant.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S9 – Neustart während klingelndem Alarm (REMINDING)

**Ziel:** Ein aktiver/repetierender Alarm überlebt einen Boot.

- **Vorbereitung:** Instanz in den `REMINDING` bringen (Alarm klingelt bzw. wartet auf die nächste Wiederholung).
- **Schritte:**
  1. Gerät neu starten.
  2. Nach dem Boot warten (kein QR-Scan).
- **Erwartetes Ergebnis:** Der Alarm **klingelt nach dem Boot weiter bzw. wieder** (spätestens zur nächsten 60-s-Wiederholung).

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S10 – Akku leer → laden → Boot

**Ziel:** Überfälliger Alarm wird nach Boot sofort nachgeholt.

- **Vorbereitung:** Instanz starten; Gerät so lange nutzen, bis der **Akku leer** ist (oder gezielt entleeren).
- **Schritte:**
  1. Gerät an das Ladegerät anschließen und hochfahren lassen.
  2. Nach dem Boot beobachten (kein QR-Scan).
- **Erwartetes Ergebnis:** Der **überfällige Alarm klingelt sofort nach dem Boot** (Deadline war während des Ausschaltens überschritten).

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S11 – Doze-Modus während WAITING

**Ziel:** `setAlarmClock`/`setExactAndAllowWhileIdle` schlägt trotz erzwungenem Doze pünktlich an.

- **Vorbereitung:** Instanz starten (`WAITING`), kurze Restzeit.
- **Schritte:**
  1. Doze erzwingen:
     ```powershell
     adb shell dumpsys deviceidle force-idle
     ```
  2. Deadline abwarten.
  3. Danach Doze beenden:
     ```powershell
     adb shell dumpsys deviceidle unforce
     ```
- **Erwartetes Ergebnis:** Der Alarm **klingelt trotzdem pünktlich** zur Deadline; Doze verzögert ihn nicht wesentlich.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S12 – Lautlos / Bitte nicht stören (DND)

**Ziel:** Alarmton umgeht Lautlos/DND über `STREAM_ALARM`/`CATEGORY_ALARM`.

- **Vorbereitung:** Instanz starten (`WAITING`).
- **Schritte:**
  1. Gerät auf **Lautlos** stellen und/oder **„Bitte nicht stören“ aktivieren**.
  2. Deadline abwarten.
- **Erwartetes Ergebnis:** Der Alarmton ist **trotzdem hörbar** (Alarm-Lautstärke; ggf. separate Alarm-Lautstärke prüfen). Andere Benachrichtigungen bleiben stumm.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

### S13 – Widerrufene Berechtigungen

**Ziel:** Degradierter Betrieb + sichtbare Warnung statt stillem Versagen.

- **Vorbereitung:** App installiert, keine aktive Instanz.

**Teil A – Exakt-Alarm-Berechtigung entziehen (Android 12+ / API 31+):**
- **Schritte:**
  1. Einstellungen → Apps → FCK-ADHD → „Alarme & Erinnerungen“ / „Exakte Alarme“ → **entziehen**.
  2. App öffnen.
- **Erwartetes Ergebnis:** Die App **warnt sichtbar**, dass exakte Alarme nicht geplant werden können, und **leitet direkt in die Systemeinstellungen** zum erneuten Erteilen.

**Teil B – Vollbild-Benachrichtigung entziehen (Android 14+ / API 34+):**
- **Schritte:**
  1. Einstellungen → Apps → FCK-ADHD → „Vollbild-Benachrichtigungen“ (Full-screen notifications) → **entziehen**.
  2. Instanz starten und Alarm abwarten.
- **Erwartetes Ergebnis:** Der Alarm erscheint **mindestens als Heads-up-Benachrichtigung** (kein vollständiges Versagen).

| Teil | Beobachtet | OK | Fehler |
|---|---|---|---|
| A (Exakt-Alarm, API 31+) | - [ ] | - [ ] | - [ ] |
| B (Vollbild, API 34+) | - [ ] | - [ ] | - [ ] |

> Nach Teil A+B Berechtigungen wieder erteilen, bevor weitere Szenarien laufen.

---

### S14 – Bildschirm aus + gesperrt während Alarm

**Ziel:** Vollbild-Alarm über dem Lockscreen (`showWhenLocked`/`turnScreenOn`).

- **Vorbereitung:** Instanz starten; Gerät **sperren** und Bildschirm ausgehen lassen.
- **Schritte:**
  1. Deadline abwarten, ohne das Gerät zu berühren.
- **Erwartetes Ergebnis:** Bildschirm **schaltet sich ein**, und der **Vollbild-Alarm erscheint über dem Lockscreen** – ohne Entsperren sichtbar und bedienbar.

| Beobachtet | OK | Fehler |
|---|---|---|
| - [ ] | - [ ] | - [ ] |

---

## 5. Bestehens-Kriterium

- [ ] **Alle 14 Szenarien (S1–S14) mit „OK“ abgeschlossen.**
- [ ] **Auf mindestens zwei Android-Versionen** gemäß Device-Matrix (mind. Android 12+ und Android 14+) grün.
- [ ] Alle aufgetretenen Fehler als Tickets dokumentiert und vor Release behoben oder bewusst akzeptiert.

> Erst wenn alle Checkboxen oben gesetzt sind, gilt Phase 6 (Härtungstest) als bestanden und Phase 7 (Polish & persönlicher Release) kann starten.

---

## 6. Bekannte Einschränkungen (kein Fehler, nicht melden)

- **Alarm-Icon in der Statusleiste:** `setAlarmClock` zeigt systemseitig ein Wecker-Icon – das ist **gewolltes Verhalten** und Zeichen, dass die Exact-Alarm-Kette aktiv ist.
- **OEM-Akkukiller (Samsung, Xiaomi, Huawei etc.):** Aggressive OEM-Akkusparmodi können den Foreground Service beenden. Die **Exact-Alarm-Kette bleibt davon unabhängig** – der Alarm wird trotzdem geplant und ausgelöst. Falls ein OEM-Gerät getestet wird: Autostart/Ausnahme-Hinweise in der Device-Matrix vermerken.
- **Audio-Pausierung** gilt nur für Apps, die sich an die Audiofokus-Regeln halten (praktisch alle gängigen; keine 100 %ige Garantie).

---

## Beobachtungen / Notizen

_Fehlerbeschreibungen, Geräte-Verhalten, OEM-Besonderheiten:_

| Szenario | Gerät | Beobachtung |
|---|---|---|
| `____` | `____` | `________________________________________________` |
| `____` | `____` | `________________________________________________` |
| `____` | `____` | `________________________________________________` |
