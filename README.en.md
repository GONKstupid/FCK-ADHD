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

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 18 | Build tooling & dev server |
| npm | >= 9 | Package installation |
| JDK | 17+ (e.g. Temurin) | Android builds (Gradle) |
| Android Studio | current version | Android SDK, emulator & native builds |

> **Web-only development?** Then Node.js + npm are enough – the browser dev
> server does not require Android Studio or a JDK.

### Step 1 – Clone repository & install dependencies

```bash
git clone https://github.com/GONKstupid/FCK-ADHD.git
cd FCK-ADHD
npm install
```

### Step 2 – Develop in the browser (fastest way to start)

```bash
npm run dev
```

Then open the address shown in the terminal (default:
`http://localhost:5173`). All screens can be tested in the browser – dashboard,
routine editing, QR export and onboarding. Camera scanning and native alarms,
of course, only work on a real device.

### Step 3 – Run quality checks

Before every commit or build, run the local checks:

```bash
npm run lint     # ESLint
npm run test     # Unit tests (Vitest)
npm run verify   # everything together: TypeScript + ESLint + Vitest
```

### Step 4 – Run on Android

1. **Install Android Studio** and let it install the Android SDK
   (including `platform-tools`) on first launch.
2. **Connect a device** – either a physical phone (enable USB debugging in
   developer options) or create an emulator.
3. **Sync web assets & open the project:**

   ```bash
   npx cap sync          # builds the web app and copies it to android/
   npx cap open android  # opens the project in Android Studio
   ```

4. Press the **Run** button in Android Studio (or run `gradlew.bat assembleDebug`).
   The app starts on the device/emulator.
5. **Grant permissions on first launch** (see below) – without them alarms may
   not ring at all or may be delayed.

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
