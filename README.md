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
- Node.js >= 18
- npm >= 9
- Android Studio (für Android-Builds)
- JDK 17+

### Installation

```bash
# Repository klonen
git clone https://github.com/GONKstupid/FCK-ADHD.git
cd FCK-ADHD

# Dependencies installieren
npm install

# Development Server starten
npm run dev

# Android-Build
npx cap sync
npx cap open android
```

### Befehle
| Befehl | Beschreibung |
|--------|-------------|
| `npm run dev` | Startet Vite Dev-Server |
| `npm run build` | TypeScript Check + Production Build |
| `npm run test` | Unit Tests (Vitest) |
| `npm run lint` | ESLint |
| `npx cap sync` | Web-Assets → Android kopieren |
| `npx cap open android` | Android Studio öffnen |

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
│   ├── blockerBridge.ts      # Capacitor Plugin Bridge
│   ├── escalationService.ts  # Eskalations-Logik
│   ├── healthCheck.ts        # Alarm-Verifizierung
│   ├── qrGenerator.ts        # QR-Code Generierung
│   ├── routineService.ts     # Routine-CRUD
│   ├── scannerService.ts     # ML Kit Scanner
│   └── timerService.ts       # Native AlarmManager + Web Fallback
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
- [ ] Phase 6: Hardening & Testing
- [ ] Phase 7: Polish & Release

## Lizenz
[MIT License](./LICENSE) – siehe [LICENSE](./LICENSE) Datei.
