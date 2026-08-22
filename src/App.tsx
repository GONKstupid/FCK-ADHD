import { useCallback, useEffect, useState } from 'react';
import DashboardScreen from './ui/screens/DashboardScreen';
import ScannerScreen from './ui/screens/ScannerScreen';
import QRExportScreen from './ui/screens/QRExportScreen';
import AlarmScreen from './ui/screens/AlarmScreen';
import ExtensionScreen from './ui/screens/ExtensionScreen';
import SettingsScreen from './ui/screens/SettingsScreen';
import OnboardingScreen, {
  isOnboardingComplete,
} from './ui/screens/OnboardingScreen';
import { startHealthCheck, stopHealthCheck } from './services/healthCheck';
import {
  startAlarmFiredListener,
  stopAlarmFiredListener,
} from './services/alarmController';
import { getRoutineById } from './services/routineService';

// ─── Simple state-based router ──────────────────────────────────────────────────

type Route =
  | { name: 'Dashboard' }
  | { name: 'Scanner' }
  | { name: 'QRExport'; routineId: string }
  | {
      name: 'Alarm';
      routineName: string;
      repeatCount: number;
      instanceId: string;
      extensionsUsed: number;
    }
  | { name: 'Extension'; instanceId: string }
  | { name: 'Settings' };

function App() {
  const [route, setRoute] = useState<Route>({ name: 'Dashboard' });
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [isDark, setIsDark] = useState(() => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // ── Onboarding check ────────────────────────────────────────────────────────
  useEffect(() => {
    void isOnboardingComplete().then(setOnboardingDone);
  }, []);

  // ── Health check (alarm verification on resume) ─────────────────────────────
  useEffect(() => {
    startHealthCheck();
    return () => stopHealthCheck();
  }, []);

  // ── Native alarmFired event channel ───────────────────────────────────────
  // The native side fires the alarm (and repeats every 60s) on its own;
  // here we only sync state + show the in-app alarm screen when visible.
  useEffect(() => {
    void startAlarmFiredListener((instance) => {
      if (instance.state !== 'REMINDING') return;
      if (document.visibilityState !== 'visible') return;
      void getRoutineById(instance.routineId).then((routine) => {
        setRoute({
          name: 'Alarm',
          routineName: routine?.name ?? 'Alarm',
          repeatCount: instance.repeatCount,
          instanceId: instance.id,
          extensionsUsed: instance.extensionsUsed,
        });
      });
    });
    return () => {
      void stopAlarmFiredListener();
    };
  }, []);

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      isDark ? 'dark' : 'light',
    );
  }, [isDark]);

  const toggleTheme = useCallback(() => setIsDark((d) => !d), []);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const navigate = useCallback(
    (screen: string, params?: Record<string, string>) => {
      switch (screen) {
        case 'Scanner':
          setRoute({ name: 'Scanner' });
          break;
        case 'QRExport':
          setRoute({
            name: 'QRExport',
            routineId: params?.routineId ?? '',
          });
          break;
        case 'Alarm':
          setRoute({
            name: 'Alarm',
            routineName: params?.routineName ?? 'Alarm',
            repeatCount: parseInt(params?.repeatCount ?? '0', 10),
            instanceId: params?.instanceId ?? '',
            extensionsUsed: parseInt(params?.extensionsUsed ?? '0', 10),
          });
          break;
        case 'Extension':
          setRoute({
            name: 'Extension',
            instanceId: params?.instanceId ?? '',
          });
          break;
        case 'Settings':
          setRoute({ name: 'Settings' });
          break;
        default:
          setRoute({ name: 'Dashboard' });
      }
    },
    [],
  );

  const goBack = useCallback(() => setRoute({ name: 'Dashboard' }), []);

  // ── Loading state while checking onboarding ─────────────────────────────────
  if (onboardingDone === null) {
    return (
      <div className="screen">
        <div className="dot-grid-bg" aria-hidden />
        <div className="empty-state">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // ── Onboarding ──────────────────────────────────────────────────────────────
  if (!onboardingDone) {
    return <OnboardingScreen onComplete={() => setOnboardingDone(true)} />;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  switch (route.name) {
    case 'Scanner':
      return <ScannerScreen onBack={goBack} />;
    case 'QRExport':
      return <QRExportScreen routineId={route.routineId} onBack={goBack} />;
    case 'Alarm':
      return (
        <AlarmScreen
          routineName={route.routineName}
          repeatCount={route.repeatCount}
          instanceId={route.instanceId}
          extensionsUsed={route.extensionsUsed}
          onExtend={() =>
            setRoute({ name: 'Extension', instanceId: route.instanceId })
          }
        />
      );
    case 'Extension':
      return (
        <ExtensionScreen
          instanceId={route.instanceId}
          onDone={goBack}
          onCancel={goBack}
        />
      );
    case 'Settings':
      return <SettingsScreen onBack={goBack} />;
    default:
      return (
        <DashboardScreen
          onNavigate={navigate}
          onThemeToggle={toggleTheme}
          isDark={isDark}
        />
      );
  }
}

export default App;
