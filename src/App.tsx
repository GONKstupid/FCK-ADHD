import { useCallback, useEffect, useRef, useState } from 'react';
import DashboardScreen from './ui/screens/DashboardScreen';
import ScannerScreen from './ui/screens/ScannerScreen';
import QRExportScreen from './ui/screens/QRExportScreen';
import AlarmScreen from './ui/screens/AlarmScreen';
import ExtensionScreen from './ui/screens/ExtensionScreen';
import RoutineEditScreen from './ui/screens/RoutineEditScreen';
import SettingsScreen from './ui/screens/SettingsScreen';
import OnboardingScreen, {
  isOnboardingComplete,
} from './ui/screens/OnboardingScreen';
import { startHealthCheck, stopHealthCheck } from './services/healthCheck';
import {
  startAlarmConfirmedListener,
  startAlarmFiredListener,
  stopAlarmConfirmedListener,
  stopAlarmFiredListener,
} from './services/alarmController';
import { getInstance, getRoutineById } from './services/routineService';
import {
  addAlarmExtendRequestedListener,
  consumePendingExtendRequest,
  isNative,
} from './services/blockerBridge';

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
  | { name: 'RoutineEdit'; routineId: string }
  | { name: 'Settings' };

function App() {
  const [route, setRoute] = useState<Route>({ name: 'Dashboard' });
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [isDark, setIsDark] = useState(() => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Mirrors the current route for event listeners that must not
  // overwrite an in-progress flow (e.g. the 60s alarm repeat).
  const routeRef = useRef<Route>(route);
  routeRef.current = route;

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
      // A 60s repeat must not overwrite an in-progress extension flow —
      // the extension would be lost mid-way.
      if (routeRef.current.name === 'Extension') return;
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

  // ── Native alarmConfirmed event channel ──────────────────────────────────
  // The native "ERLEDIGT – HALTEN" button already runs handleConfirmDone
  // inside the controller — here we only mirror the navigation effect: if
  // the confirmed instance is the one currently shown on the AlarmScreen,
  // leave it (the step advanced or the routine completed).
  useEffect(() => {
    void startAlarmConfirmedListener((instanceId) => {
      setRoute((current) =>
        current.name === 'Alarm' && current.instanceId === instanceId
          ? { name: 'Dashboard' }
          : current,
      );
    });
    return () => {
      void stopAlarmConfirmedListener();
    };
  }, []);

  // ── Native alarmExtendRequested event channel ─────────────────────────────
  // The native alarm overlay emits it when the user taps "VERLÄNGERN" —
  // we open the extension flow for that instance.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void addAlarmExtendRequestedListener((event) => {
      setRoute({ name: 'Extension', instanceId: event.instanceId });
    }).then((un) => {
      if (active) unsubscribe = un;
      else un();
    });
    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // ── Pending extend request recovery (WebView recreated) ───────────────────
  // If the WebView was restarted, the alarmExtendRequested event is lost —
  // on becoming visible again we poll the native pending-request queue.
  useEffect(() => {
    if (!isNative()) return;
    const consumePending = () => {
      void consumePendingExtendRequest().then(async ({ instanceId }) => {
        if (!instanceId) return;
        // Staleness guard: a persisted request can survive process
        // death — only open the extension flow while the instance still
        // exists AND is ringing. A stale request for a completed/
        // vanished instance must not force-open the screen.
        const instance = await getInstance(instanceId);
        if (!instance || instance.state !== 'REMINDING') return;
        setRoute({ name: 'Extension', instanceId });
      });
    };
    // Cold start: the document is already visible, so no
    // visibilitychange fires — consume a persisted pending request now.
    consumePending();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      consumePending();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
        case 'RoutineEdit':
          setRoute({
            name: 'RoutineEdit',
            routineId: params?.routineId ?? '',
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
          onDone={goBack}
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
    case 'RoutineEdit':
      return <RoutineEditScreen routineId={route.routineId} onBack={goBack} />;
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
