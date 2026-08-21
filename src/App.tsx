import { useCallback, useEffect, useState } from 'react';
import DashboardScreen from './ui/screens/DashboardScreen';
import ScannerScreen from './ui/screens/ScannerScreen';
import QRExportScreen from './ui/screens/QRExportScreen';
import AlarmScreen from './ui/screens/AlarmScreen';
import OnboardingScreen, {
  isOnboardingComplete,
} from './ui/screens/OnboardingScreen';
import { startHealthCheck, stopHealthCheck } from './services/healthCheck';

// ─── Simple state-based router ──────────────────────────────────────────────────

type Route =
  | { name: 'Dashboard' }
  | { name: 'Scanner' }
  | { name: 'QRExport'; routineId: string }
  | { name: 'Alarm'; routineName: string; repeatCount: number };

function App() {
  const [route, setRoute] = useState<Route>({ name: 'Dashboard' });
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [isDark, setIsDark] = useState(() => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // ── Onboarding check ────────────────────────────────────────────────────────
  useEffect(() => {
    isOnboardingComplete().then(setOnboardingDone);
  }, []);

  // ── Health check (alarm verification on resume) ─────────────────────────────
  useEffect(() => {
    startHealthCheck();
    return () => stopHealthCheck();
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
          });
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
    return (
      <OnboardingScreen
        onComplete={() => setOnboardingDone(true)}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  switch (route.name) {
    case 'Scanner':
      return <ScannerScreen onBack={goBack} />;
    case 'QRExport':
      return (
        <QRExportScreen
          routineId={route.routineId}
          onBack={goBack}
        />
      );
    case 'Alarm':
      return (
        <AlarmScreen
          routineName={route.routineName}
          repeatCount={route.repeatCount}
          onDismiss={goBack}
        />
      );
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
