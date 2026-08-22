# FCK ADHD – Safety Reminder App

[Deutsche Version](./README.md)

## Overview
FCK ADHD is a personal safety reminder app designed for people with ADHD. The app uses QR codes and escalating full-screen alarms to ensure that critical household actions (e.g. turning off the stove) are not forgotten.

## Features
- 🔲 QR-code based triggers (scan to start/confirm)
- ⏰ Precise timers with native Android alarms (survives app kill & reboot)
- 🚨 Full-screen alarm over lock screen with audio focus
- 🧩 Extension system with math puzzle + hold gesture as safeguard
- 📈 Escalation after 3x repetition (ringtone)
- 🌓 Light/Dark theme (Nothing OS-inspired design)

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite (SWC)
- **Mobile:** Capacitor 8 (Android)
- **Database:** Dexie.js (IndexedDB)
- **Native:** Kotlin plugin (AlarmManager, Full-Screen Intent, AudioFocus)
- **Scanner:** ML Kit Barcode Scanning

## Quick Start

### Prerequisites
- Node.js >= 18
- npm >= 9
- Android Studio (for Android builds)
- JDK 17+

### Installation

```bash
# Clone repository
git clone https://github.com/GONKstupid/FCK-ADHD.git
cd FCK-ADHD

# Install dependencies
npm install

# Start development server
npm run dev

# Android build
npx cap sync
npx cap open android
```

### Commands
| Command | Description |
|---------|-------------|
| `npm run dev` | Starts Vite dev server |
| `npm run build` | TypeScript check + production build |
| `npm run test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npx cap sync` | Copy web assets → Android |
| `npx cap open android` | Open in Android Studio |

## Project Structure

```
src/
├── assets/          # Global styles & static resources
│   └── global.css
├── core/            # Data models & state machine
│   ├── models.ts
│   └── stateMachine.ts
├── data/            # IndexedDB (Dexie) & seed data
│   ├── db.ts
│   └── seed.ts
├── services/        # Business logic & native bridges
│   ├── alarmController.ts    # Central alarm orchestration
│   ├── blockerBridge.ts      # Capacitor plugin bridge
│   ├── escalationService.ts  # Escalation logic
│   ├── healthCheck.ts        # Alarm verification
│   ├── qrGenerator.ts        # QR code generation
│   ├── routineService.ts     # Routine CRUD
│   └── scannerService.ts     # ML Kit scanner
├── ui/
│   ├── components/  # Reusable UI building blocks
│   │   ├── HoldButton.tsx    # Hold gesture component
│   │   └── MathPuzzle.tsx    # Math puzzle extension
│   └── screens/     # Main screens
│       ├── AlarmScreen.tsx       # Full-screen alarm UI
│       ├── DashboardScreen.tsx   # Overview & routines
│       ├── ExtensionScreen.tsx   # Puzzle/hold extension
│       ├── OnboardingScreen.tsx  # Initial setup
│       ├── QRExportScreen.tsx    # QR code export/print
│       └── ScannerScreen.tsx     # QR code scanner
├── App.tsx           # Root component & routing
└── main.tsx          # App entry point
```

## Roadmap
- [x] Phase 0: Project setup
- [x] Phase 1: Data model & state machine
- [x] Phase 2: QR code flow
- [x] Phase 3: Native blocking plugin
- [x] Phase 4: Background reliability
- [x] Phase 5: Extension & escalation
- [x] Phase 6: Hardening & testing
- [x] Phase 7: Polish & release

> **Note:** Automated hardening (93 unit tests) and the signed release APK are complete.
> The final manual step is executing the device hardening checklist [`docs/haertungstest-checkliste.md`](docs/haertungstest-checkliste.md) (S1–S14) on real devices (≥1× Android 12+, ≥1× Android 14+).

## License
[MIT License](./LICENSE) – see [LICENSE](./LICENSE) file.
