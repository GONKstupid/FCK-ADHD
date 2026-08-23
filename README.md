# FCK ADHD – Sicherheits-Erinnerungs-App

[English version](./README.en.md)

## Überblick
FCK ADHD ist eine persönliche Sicherheits-Erinnerungs-App für ADHD-Betroffene. Die App nutzt QR-Codes und eskalierende Fullscreen-Alarme, um sicherzustellen, dass kritische Haushaltsaktionen (z.B. Herd ausschalten) nicht vergessen werden.

## Features
- 🔲 QR-Code basierte Trigger (Scan zum Starten/Bestätigen)
- ⏰ Exakte Timer mit nativen Android-Alarmen (überlebt App-Kill & Reboot)
- 🚨 Fullscreen-Alarm über Lock-Screen mit Audio-Focus
- 🧩 Extension-System mit Math-Puzzle + Hold-Geste als Schutz
- 📈 Escalation nach 3x Wiederholung (Klingelton)
- 🌓 Light/Dark Theme (Nothing OS-inspiriertes Design)

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite (SWC)
- **Mobile:** Capacitor 8 (Android)
- **Datenbank:** Dexie.js (IndexedDB)
- **Native:** Kotlin Plugin (AlarmManager, Full-Screen Intent, AudioFocus)
- **Scanner:** ML Kit Barcode Scanning

## Quick Start

### Voraussetzungen

| Werkzeug | Version | Wofür |
|----------|---------|-------|
| Node.js | >= 18 | Build-Tooling & Dev-Server |
| npm | >= 9 | Paket-Installation |
| JDK | 17+ (z. B. Temurin) | Android-Builds (Gradle) |
| Android Studio | aktuelle Version | Android SDK, Emulator & native Builds |

> **Nur Web-Entwicklung?** Dann reichen Node.js + npm – für den Browser-Dev-Server
> wird weder Android Studio noch ein JDK benötigt.

### Schritt 1 – Repository klonen & Dependencies installieren

```bash
git clone https://github.com/GONKstupid/FCK-ADHD.git
cd FCK-ADHD
npm install
```

### Schritt 2 – Im Browser entwickeln (schnellster Einstieg)

```bash
npm run dev
```

Danach die im Terminal angezeigte Adresse öffnen (Standard:
`http://localhost:5173`). Im Browser lassen sich alle Screens testen – Dashboard,
Routinen bearbeiten, QR-Export und Onboarding. Kamera-Scan und native Alarme
funktionieren natürlich nur auf einem echten Gerät.

### Schritt 3 – Qualität prüfen

Vor jedem Commit bzw. Build sollten die Checks lokal laufen:

```bash
npm run lint     # ESLint
npm run test     # Unit Tests (Vitest)
npm run verify   # alles zusammen: TypeScript + ESLint + Vitest
```

### Schritt 4 – Auf Android laufen lassen

1. **Android Studio installieren** und beim ersten Start das Android SDK
   (inkl. `platform-tools`) mitinstallieren lassen.
2. **Gerät verbinden** – entweder ein physisches Handy (USB-Debugging in den
   Entwickleroptionen aktivieren) oder einen Emulator anlegen.
3. **Web-Assets syncen & Projekt öffnen:**

   ```bash
   npx cap sync          # baut die Web-App und kopiert sie nach android/
   npx cap open android  # öffnet das Projekt in Android Studio
   ```

4. In Android Studio den **Run**-Button drücken (oder `gradlew.bat assembleDebug`).
   Die App startet auf dem Gerät/Emulator.
5. **Berechtigungen beim ersten Start gewähren** (siehe unten) – ohne diese
   klingeln Alarme u. U. nicht oder zu spät.

### Befehle

| Befehl | Beschreibung |
|--------|-------------|
| `npm run dev` | Startet Vite Dev-Server |
| `npm run build` | TypeScript Check + Production Build |
| `npm run test` | Unit Tests (Vitest) |
| `npm run lint` | ESLint |
| `npx cap sync` | Web-Assets → Android kopieren |
| `npx cap open android` | Android Studio öffnen |
| `npm run dist:android` | Signierte Release-APK bauen (Sideload) |
| `npm run check:native` | Kotlin/Native-Code per Gradle kompilieren (`compileDebugKotlin`) |
| `npm run verify` | Vollständige Web-Prüfung: TypeScript + ESLint + Vitest |

> ⚠️ **Hinweis:** Die Gesundheit des Kotlin/Native-Codes wird **ausschließlich** über `npm run check:native` (Gradle) geprüft – **nicht** über Editor-Diagnosen. Der Kotlin Language Server zeigt Phantom-Fehler an, weil er den AGP/Android-Classpath nicht auflösen kann; die Quellen kompilieren sauber über Gradle. `npm run verify` führt die vollständige Prüfung der Web-Seite aus (TypeScript + ESLint + Vitest).

## Release-APK bauen & installieren (Sideload)

Für den privaten Gebrauch wird eine **signierte Release-APK** gebaut und direkt aufs
Handy gespielt (Sideload) – ohne Play Store.

### Voraussetzungen
- JDK 17+ (Temurin) und Android SDK (siehe [Quick Start](#quick-start))
- Einmalig angelegter Release-Keystore (siehe unten) – **wird nicht mit committet**

### Keystore (einmalig anlegen)
Der Keystore liegt unter `android/app/fckadhd-release.keystore`, die Zugangsdaten in der
gitignore­ten Datei `android/keystore.properties`. Falls beides fehlt (z.B. auf einem
frischen Rechner), einmalig neu erzeugen:

```bash
keytool -genkeypair -storetype JKS -keystore android/app/fckadhd-release.keystore \
  -alias fckadhd -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <STORE-PASSWORT> -keypass <KEY-PASSWORT> \
  -dname "CN=FCK-ADHD, OU=Private, O=gonkstupid, C=DE"
```

Anschließend `android/keystore.properties` anlegen:

```properties
RELEASE_STORE_FILE=fckadhd-release.keystore
RELEASE_STORE_PASSWORD=<STORE-PASSWORT>
RELEASE_KEY_ALIAS=fckadhd
RELEASE_KEY_PASSWORD=<KEY-PASSWORT>
```

> ⚠️ **WICHTIG – Keystore sichern!**
> Der Keystore + die Passwörter sind die **einzige** Möglichkeit, Updates für diese App
> zu signieren. **Verlust = keine Updates mehr möglich** (die App müsste deinstalliert und
> unter neuer Signatur neu installiert werden). Keystore-Datei **und** Passwörter sicher
> aufbewahren (z.B. Passwort-Manager + Backup-Kopie), aber **niemals committen**.

### Release-APK bauen

```bash
npm run dist:android
```

Das Skript führt automatisch aus: `npm run build` (TypeScript + Vite) → `cap sync android`
(Web-Assets aktualisieren) → `gradlew.bat assembleRelease` (signierte APK erzeugen).

Die fertige APK liegt danach unter:

```
android/app/build/outputs/apk/release/app-release.apk
```

### Auf dem Gerät installieren

**Variante A – per ADB (USB-Debugging aktiviert):**

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**Variante B – per Dateiübertragung:**
Die APK-Datei aufs Handy kopieren (z.B. USB, Cloud oder Messenger) und dort antippen.
Android fragt beim ersten Mal, ob „Unbekannte Apps installieren“ erlaubt werden soll –
dies einmalig für die jeweilige Datei-App bestätigen.

### Berechtigungen beim ersten Start
Beim ersten Start bzw. bei der ersten Nutzung fragt die App folgende Berechtigungen ab,
die für die Zuverlässigkeit der Alarme benötigt werden:

- **Kamera** – zum Scannen der QR-Codes
- **Exakte Alarme / Wecker** – damit Timer auch bei App-Kill & Reboot pünktlich klingeln
- **Benachrichtigungen / Vollbild-Alarm** – für den Fullscreen-Alarm über dem Lock-Screen
- **Akku-Optimierung ignorieren** *(empfohlen)* – damit Android die Alarme im Hintergrund
  nicht drosselt

Ohne diese Freigaben kann es passieren, dass Alarme nicht oder verspätet ausgelöst werden.

## Projektstruktur

```
src/
├── assets/          # Globale Styles & statische Ressourcen
│   └── global.css
├── core/            # Datenmodelle & State Machine
│   ├── models.ts
│   └── stateMachine.ts
├── data/            # IndexedDB (Dexie) & Seed-Daten
│   ├── db.ts
│   └── seed.ts
├── services/        # Business-Logik & Native-Bridges
│   ├── alarmController.ts    # Zentrale Alarm-Orchestrierung
│   ├── blockerBridge.ts      # Capacitor Plugin Bridge
│   ├── escalationService.ts  # Eskalations-Logik
│   ├── healthCheck.ts        # Alarm-Verifizierung
│   ├── qrGenerator.ts        # QR-Code Generierung
│   ├── routineService.ts     # Routine-CRUD
│   └── scannerService.ts     # ML Kit Scanner
├── ui/
│   ├── components/  # Wiederverwendbare UI-Bausteine
│   │   ├── HoldButton.tsx    # Hold-Geste Komponente
│   │   └── MathPuzzle.tsx    # Mathematik-Puzzle Extension
│   └── screens/     # Hauptbildschirme
│       ├── AlarmScreen.tsx       # Fullscreen Alarm UI
│       ├── DashboardScreen.tsx   # Übersicht & Routinen
│       ├── ExtensionScreen.tsx   # Puzzle/Hold Extension
│       ├── OnboardingScreen.tsx  # Erst-Einrichtung
│       ├── QRExportScreen.tsx    # QR-Code Export/Druck
│       └── ScannerScreen.tsx     # QR-Code Scanner
├── App.tsx           # Root-Komponente & Routing
└── main.tsx          # App-Einstiegspunkt
```

## Roadmap
- [x] Phase 0: Projekt-Setup
- [x] Phase 1: Datenmodell & State Machine
- [x] Phase 2: QR-Code Flow
- [x] Phase 3: Native Blocking Plugin
- [x] Phase 4: Background Reliability
- [x] Phase 5: Extension & Escalation
- [x] Phase 6: Hardening & Testing
- [x] Phase 7: Polish & Release

> **Hinweis:** Automatisiertes Hardening (93 Unit-Tests) und die signierte Release-APK sind abgeschlossen.
> Der letzte manuelle Schritt ist die Ausführung der Geräte-Härtungs-Checkliste [`docs/haertungstest-checkliste.md`](docs/haertungstest-checkliste.md) (S1–S14) auf echten Geräten (≥1× Android 12+, ≥1× Android 14+).

## Lizenz
[MIT License](./LICENSE) – siehe [LICENSE](./LICENSE) Datei.
