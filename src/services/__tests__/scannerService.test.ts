import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
import type { Routine, RoutineInstance, Step } from '../../core/models';
import {
  startScan,
  stopScan,
  resetDebounce,
  requestCameraPermission,
} from '../scannerService';
import { handleScanResult } from '../alarmController';
import * as bridge from '../blockerBridge';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// The ML Kit barcode scanner plugin is fully mocked so no camera/native call
// ever happens. For the S2 flow (scan during WAITING ends the instance) the
// Dexie database is replaced by an in-memory store and blockerBridge is
// mocked — the same boundaries used in alarmController.test.ts — so the REAL
// alarmController + stateMachine run underneath.

const scannerMock = vi.hoisted(() => {
  type ScanEvent = { barcodes: Array<{ rawValue?: string }> };
  const listeners = new Map<string, (event: ScanEvent) => void>();

  return {
    listeners,
    addListener: vi.fn((eventName: string, cb: (event: ScanEvent) => void) => {
      listeners.set(eventName, cb);
      return Promise.resolve({ remove: vi.fn(() => Promise.resolve()) });
    }),
    startScan: vi.fn(() => Promise.resolve()),
    stopScan: vi.fn(() => Promise.resolve()),
    requestPermissions: vi.fn(() => Promise.resolve({ camera: 'granted' })),
  };
});

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: scannerMock,
  // Value irrelevant for the tests — only needs to exist so the real module
  // import in scannerService resolves against the mock.
  BarcodeFormat: { QrCode: 'QR_CODE' },
}));

const store = vi.hoisted(() => {
  const routines = new Map<string, Routine>();
  const instances = new Map<string, RoutineInstance>();

  // Captures the lo/hi bounds passed to Dexie's between() so tests can
  // verify the compound-index range used by getActiveInstance.
  const betweenSpy = vi.fn();

  const routinesTable = {
    add: (r: Routine): Promise<string> => {
      routines.set(r.id, r);
      return Promise.resolve(r.id);
    },
    get: (id: string) => Promise.resolve(routines.get(id)),
    where: (field: keyof Routine) => ({
      equals: (value: string) => ({
        first: () =>
          Promise.resolve(
            [...routines.values()].find((r) => r[field] === value),
          ),
      }),
    }),
    toArray: () => Promise.resolve([...routines.values()]),
    delete: (id: string) => {
      routines.delete(id);
      return Promise.resolve();
    },
  };

  const instancesTable = {
    add: (i: RoutineInstance): Promise<string> => {
      instances.set(i.id, i);
      return Promise.resolve(i.id);
    },
    get: (id: string) => Promise.resolve(instances.get(id)),
    put: vi.fn((i: RoutineInstance): Promise<void> => {
      instances.set(i.id, i);
      return Promise.resolve();
    }),
    update: (id: string, changes: Partial<RoutineInstance>) => {
      const current = instances.get(id);
      if (current) instances.set(id, { ...current, ...changes });
      return Promise.resolve();
    },
    where: () => ({
      between: (...args: unknown[]) => {
        betweenSpy(...args);
        return {
          filter: (pred: (i: RoutineInstance) => boolean) => ({
            first: () => Promise.resolve([...instances.values()].find(pred)),
          }),
        };
      },
    }),
  };

  return {
    routines,
    instances,
    betweenSpy,
    instancePut: instancesTable.put,
    db: { routines: routinesTable, instances: instancesTable },
  };
});

vi.mock('../../data/db', () => ({
  FckAdhdDatabase: class {},
  db: store.db,
}));

vi.mock('../blockerBridge', () => ({
  scheduleExactAlarm: vi.fn(() => Promise.resolve()),
  cancelAlarm: vi.fn(() => Promise.resolve()),
  dismissAlarm: vi.fn(() => Promise.resolve()),
  releaseAudioFocus: vi.fn(() => Promise.resolve()),
  requestAudioFocus: vi.fn(() => Promise.resolve()),
  showAlarm: vi.fn(() => Promise.resolve()),
  addAlarmFiredListener: vi.fn(() => Promise.resolve(() => {})),
}));

const cancelAlarm = vi.mocked(bridge.cancelAlarm);
const dismissAlarm = vi.mocked(bridge.dismissAlarm);
const releaseAudioFocus = vi.mocked(bridge.releaseAudioFocus);
const scheduleExactAlarm = vi.mocked(bridge.scheduleExactAlarm);

// ─── Platform simulation ──────────────────────────────────────────────────────
//
// The test environment is node (no window), so `window` is injected to
// simulate either the native Capacitor platform or the web fallback.

const globals = globalThis as Record<string, unknown>;

function mockNativePlatform(): void {
  globals.window = { Capacitor: { isNativePlatform: () => true } };
}

function mockWebPlatform(prompt?: (message: string) => string | null): void {
  globals.window = {
    Capacitor: { isNativePlatform: () => false },
    prompt,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp
const MIN = 60_000;
const ROUTINE_NAME = 'Herd / Dunstabzugshaube';

async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** Starts a native scan and fires the barcodesScanned event with `rawValue`. */
async function scan(rawValue?: string): Promise<string> {
  const pending = startScan();
  await flushMicrotasks(); // let startScan register its listeners
  const cb = scannerMock.listeners.get('barcodesScanned');
  expect(cb).toBeDefined();
  cb!({ barcodes: rawValue === undefined ? [] : [{ rawValue }] });
  return pending;
}

function seedRoutine(
  id: string,
  qrCodeId: string,
  steps: Step[],
  name: string = ROUTINE_NAME,
): Routine {
  const routine: Routine = {
    id,
    name,
    qrCodeId,
    steps,
    createdAt: NOW - 60_000,
  };
  store.routines.set(id, routine);
  return routine;
}

function seedInstance(overrides: Partial<RoutineInstance>): RoutineInstance {
  const instance: RoutineInstance = {
    id: 'inst-1',
    routineId: 'routine-1',
    state: 'IDLE',
    currentStepIndex: 0,
    startedAt: NOW - 60_000,
    deadline: null,
    repeatCount: 0,
    extensionsUsed: 0,
    completedAt: null,
    ...overrides,
  };
  store.instances.set(instance.id, instance);
  return instance;
}

beforeEach(() => {
  store.routines.clear();
  store.instances.clear();
  scannerMock.listeners.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetDebounce();
  mockNativePlatform();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete globals.window;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('scannerService – 2s scan debounce (S1)', () => {
  it('resolves the first scan of a QR code value', async () => {
    await expect(scan('qr-1')).resolves.toBe('qr-1');
    expect(scannerMock.startScan).toHaveBeenCalledTimes(1);
    expect(scannerMock.stopScan).toHaveBeenCalledTimes(1); // scan stopped after hit
  });

  it('rejects a duplicate scan of the same value within 2 seconds', async () => {
    await scan('qr-1');

    vi.setSystemTime(NOW + 1_000); // still inside the 2s window
    await expect(scan('qr-1')).rejects.toThrow('DEBOUNCED');
  });

  it('does not debounce a different QR code value within the window', async () => {
    await scan('qr-1');

    vi.setSystemTime(NOW + 1_000);
    await expect(scan('qr-2')).resolves.toBe('qr-2');
  });

  it('accepts the same value again once 2 seconds have passed', async () => {
    await scan('qr-1');

    vi.setSystemTime(NOW + 1_000);
    await expect(scan('qr-1')).rejects.toThrow('DEBOUNCED');

    // 2_001 ms after the FIRST accepted scan — the debounced attempt did
    // not refresh the window
    vi.setSystemTime(NOW + 2_001);
    await expect(scan('qr-1')).resolves.toBe('qr-1');
  });

  it('resetDebounce allows an immediate re-scan of the same value', async () => {
    await scan('qr-1');

    resetDebounce(); // called when leaving the scanner screen
    await expect(scan('qr-1')).resolves.toBe('qr-1');
  });

  it('applies the same debounce to the web fallback (prompt)', async () => {
    const prompt = vi.fn(() => '  qr-web ');
    mockWebPlatform(prompt);

    await expect(startScan()).resolves.toBe('qr-web'); // trimmed

    prompt.mockReturnValueOnce('qr-web');
    await expect(startScan()).rejects.toThrow('DEBOUNCED');
    expect(scannerMock.startScan).not.toHaveBeenCalled(); // never native
  });
});

describe('scannerService – native scan error paths', () => {
  it('rejects when the scanned barcode has no value', async () => {
    await expect(scan(undefined)).rejects.toThrow('Barcode has no value');
  });

  it('rejects with "Scan failed" on a scanError event', async () => {
    const pending = startScan();
    await flushMicrotasks();
    const cb = scannerMock.listeners.get('scanError');
    expect(cb).toBeDefined();
    cb!({ barcodes: [] });

    await expect(pending).rejects.toThrow('Scan failed');
  });
});

describe('scannerService – requestCameraPermission', () => {
  it('returns true on web without touching the plugin', async () => {
    mockWebPlatform();

    await expect(requestCameraPermission()).resolves.toBe(true);
    expect(scannerMock.requestPermissions).not.toHaveBeenCalled();
  });

  it('returns true when the native permission is granted', async () => {
    await expect(requestCameraPermission()).resolves.toBe(true);
    expect(scannerMock.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('returns false when the native permission is denied', async () => {
    scannerMock.requestPermissions.mockResolvedValueOnce({ camera: 'denied' });

    await expect(requestCameraPermission()).resolves.toBe(false);
  });

  it('returns false when the permission request throws', async () => {
    scannerMock.requestPermissions.mockRejectedValueOnce(new Error('boom'));

    await expect(requestCameraPermission()).resolves.toBe(false);
  });
});

describe('scannerService – stopScan', () => {
  it('stops the native scan on a native platform', () => {
    stopScan();
    expect(scannerMock.stopScan).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', () => {
    mockWebPlatform();
    stopScan();
    expect(scannerMock.stopScan).not.toHaveBeenCalled();
  });
});

describe('scannerService – scanning the active QR during WAITING ends the instance (S2)', () => {
  it('completes a WAITING instance when its QR code is scanned early', async () => {
    // single delayed step → the routine completes on the confirm scan
    seedRoutine('routine-1', 'qr-1', [
      {
        id: 's1',
        label: 'Herd ausschalten!',
        type: 'delayed_reminder',
        delayMinutes: 30,
      },
    ]);
    seedInstance({
      state: 'WAITING',
      currentStepIndex: 0,
      deadline: NOW + 30 * MIN,
    });

    // 1. The scanner returns the QR value (debounce lets the first scan pass)
    const qrCodeId = await scan('qr-1');
    expect(qrCodeId).toBe('qr-1');

    // 2. The scan result ends the running instance
    const result = await handleScanResult(qrCodeId);
    const instance = store.instances.get('inst-1')!;

    // getActiveInstance must query the exact compound-index range
    expect(store.betweenSpy).toHaveBeenCalledWith(
      ['routine-1', 'IDLE'],
      ['routine-1', 'WAITING\uFFFF'],
    );

    expect(result.status).toBe('completed');
    expect(instance.state).toBe('IDLE');
    expect(instance.completedAt).toBe(NOW);
    expect(instance.deadline).toBeNull();

    // IDLE side effects: cancel + dismiss + release audio
    expect(cancelAlarm).toHaveBeenCalledWith('inst-1');
    expect(dismissAlarm).toHaveBeenCalledTimes(1);
    expect(releaseAudioFocus).toHaveBeenCalledTimes(1);
    expect(scheduleExactAlarm).not.toHaveBeenCalled();
  });

  it('a debounced duplicate scan never reaches the controller', async () => {
    seedRoutine('routine-1', 'qr-1', [
      {
        id: 's1',
        label: 'Herd ausschalten!',
        type: 'delayed_reminder',
        delayMinutes: 30,
      },
    ]);
    seedInstance({
      state: 'WAITING',
      currentStepIndex: 0,
      deadline: NOW + 30 * MIN,
    });

    await scan('qr-1'); // first scan consumes the debounce window

    vi.setSystemTime(NOW + 500);
    // second scan of the same QR within 2s → rejected before any controller
    // call could happen
    await expect(scan('qr-1')).rejects.toThrow('DEBOUNCED');
    expect(store.instancePut).not.toHaveBeenCalled();
    expect(store.instances.get('inst-1')!.state).toBe('WAITING');
  });
});
