import QRCode from 'qrcode';

/**
 * Generates an SVG string for the given QR code ID.
 * The SVG can be embedded directly in HTML or saved for printing.
 */
export async function generateQRSvg(qrCodeId: string): Promise<string> {
  return QRCode.toString(qrCodeId, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: {
      dark: '#1a1a1a',
      light: '#f5f3ec',
    },
  });
}

/**
 * Generates a data URL (PNG) for the given QR code ID.
 * Useful for displaying in <img> tags or canvas contexts.
 */
export async function generateQRDataUrl(qrCodeId: string): Promise<string> {
  return QRCode.toDataURL(qrCodeId, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    color: {
      dark: '#1a1a1a',
      light: '#f5f3ec',
    },
  });
}

/**
 * Generates a high-resolution PNG data URL (default 2048px) for the given
 * QR code ID — suitable for saving to the photo gallery / printing.
 */
export async function generateQRDataUrlHighRes(
  qrCodeId: string,
  sizePx = 2048,
): Promise<string> {
  return QRCode.toDataURL(qrCodeId, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: sizePx,
    color: {
      dark: '#1a1a1a',
      light: '#f5f3ec',
    },
  });
}
