import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import type { PluginListenerHandle } from '@capacitor/core';

// ─── Debounce logic ─────────────────────────────────────────────────────────────
const DEBOUNCE_MS = 2000;
let lastScannedId: string | null = null;
let lastScannedAt = 0;

function isDebounced(qrCodeId: string): boolean {
  const now = Date.now();
  if (qrCodeId === lastScannedId && now - lastScannedAt < DEBOUNCE_MS) {
    return true;
  }
  lastScannedId = qrCodeId;
  lastScannedAt = now;
  return false;
}

/** Resets the debounce state (call when leaving scanner screen). */
export function resetDebounce(): void {
  lastScannedId = null;
  lastScannedAt = 0;
}

// ─── Platform detection ─────────────────────────────────────────────────────────

function isNativePlatform(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Capacitor' in window &&
    typeof (window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor
      .isNativePlatform === 'function' &&
    (window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform()
  );
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Requests camera permission (native only).
 * Returns true if granted or if running on web (no permission needed for mock).
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (!isNativePlatform()) return true;
  try {
    const result = await BarcodeScanner.requestPermissions();
    return result.camera === 'granted' || result.camera === 'limited';
  } catch {
    return false;
  }
}

/**
 * Starts a barcode scan.
 * - On native: opens the ML Kit camera viewfinder and waits for barcodesScanned event.
 * - On web: falls back to a prompt for manual QR code input.
 *
 * Returns the decoded QR code value, or throws if cancelled/debounced.
 */
export async function startScan(): Promise<string> {
  if (!isNativePlatform()) {
    return webFallbackScan();
  }

  return new Promise<string>((resolve, reject) => {
    let listenerHandle: PluginListenerHandle | null = null;
    let errorHandle: PluginListenerHandle | null = null;
    let settled = false;

    async function cleanup() {
      if (listenerHandle) await listenerHandle.remove();
      if (errorHandle) await errorHandle.remove();
    }

    (async () => {
      try {
        listenerHandle = await BarcodeScanner.addListener('barcodesScanned', async (event) => {
          if (settled) return;
          settled = true;
          await BarcodeScanner.stopScan();
          await cleanup();

          const rawValue = event.barcodes[0]?.rawValue;
          if (!rawValue) {
            reject(new Error('Barcode has no value'));
            return;
          }

          if (isDebounced(rawValue)) {
            reject(new Error('DEBOUNCED'));
            return;
          }

          resolve(rawValue);
        });

        errorHandle = await BarcodeScanner.addListener('scanError', async () => {
          if (settled) return;
          settled = true;
          await cleanup();
          reject(new Error('Scan failed'));
        });

        await BarcodeScanner.startScan();
      } catch (err) {
        if (!settled) {
          settled = true;
          await cleanup();
          reject(new Error('Scan failed or was cancelled'));
        }
      }
    })();
  });
}

/**
 * Stops an active scan (native only).
 */
export function stopScan(): void {
  if (isNativePlatform()) {
    BarcodeScanner.stopScan().catch(() => {
      // silently ignore — scan may already be stopped
    });
  }
}

// ─── Web fallback ───────────────────────────────────────────────────────────────

/**
 * Web fallback: prompts user to manually type/paste a QR code value.
 * In a production app this could be replaced with a webcam-based scanner.
 */
async function webFallbackScan(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const value = window.prompt(
      'Web-Modus: Bitte QR-Code-Wert eingeben (oder Scannen abbrechen):',
    );

    if (value === null || value.trim() === '') {
      reject(new Error('Scan cancelled'));
      return;
    }

    const trimmed = value.trim();

    if (isDebounced(trimmed)) {
      reject(new Error('DEBOUNCED'));
      return;
    }

    resolve(trimmed);
  });
}
