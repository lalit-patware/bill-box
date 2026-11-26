/**
 * On-device QR/barcode reading. Results are sent to the API as hints
 * (reliable data the model should prefer over unclear text).
 */

export interface UpiHint {
  pa: string; // VPA, e.g. ramesh@okaxis
  pn?: string; // payee name
  am?: string;
}

export interface GstInvoiceHint {
  sellerGstin?: string;
  buyerGstin?: string;
  docNo?: string;
  docType?: string;
  docDate?: string; // as printed, dd/mm/yyyy
  totalValue?: number;
  itemCount?: number;
  irn?: string;
}

export interface CodeHints {
  upi?: UpiHint;
  gst?: GstInvoiceHint;
  barcodes?: { format: string; text: string }[];
}

export interface RawCode {
  format: string;
  text: string;
}

export function parseUpi(text: string): UpiHint | null {
  if (!text.toLowerCase().startsWith('upi://pay')) return null;
  try {
    const params = new URL(text).searchParams;
    const pa = params.get('pa');
    if (!pa) return null;
    const hint: UpiHint = { pa };
    const pn = params.get('pn');
    const am = params.get('am');
    if (pn) hint.pn = pn;
    if (am) hint.am = am;
    return hint;
  } catch {
    return null;
  }
}

function b64urlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * GST e-invoice QR = signed JWT. We only decode the payload (no signature check);
 * it is a hint, not proof.
 */
export function parseGstQr(text: string): GstInvoiceHint | null {
  const parts = text.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]!)) as Record<string, unknown>;
    const raw = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload;
    const d = raw as Record<string, unknown>;
    if (!d.SellerGstin && !d.DocNo && !d.Irn) return null;
    const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : undefined);
    const num = (k: string) => (d[k] === undefined ? undefined : Number(d[k]));
    const hint: GstInvoiceHint = {
      sellerGstin: str('SellerGstin'),
      buyerGstin: str('BuyerGstin'),
      docNo: str('DocNo'),
      docType: str('DocTyp'),
      docDate: str('DocDt'),
      totalValue: num('TotInvVal'),
      itemCount: num('ItemCnt'),
      irn: str('Irn'),
    };
    return Object.fromEntries(
      Object.entries(hint).filter(([, v]) => v !== undefined && !Number.isNaN(v)),
    ) as GstInvoiceHint;
  } catch {
    return null;
  }
}

export function buildHints(codes: RawCode[]): CodeHints | null {
  const hints: CodeHints = {};
  const barcodes: RawCode[] = [];
  for (const c of codes) {
    const upi = parseUpi(c.text);
    if (upi) {
      hints.upi ??= upi;
      continue;
    }
    const gst = parseGstQr(c.text);
    if (gst) {
      hints.gst ??= gst;
      continue;
    }
    if (c.text.length <= 64 && !barcodes.some((b) => b.text === c.text)) {
      barcodes.push({ format: c.format, text: c.text });
    }
  }
  if (barcodes.length) hints.barcodes = barcodes.slice(0, 5);
  return Object.keys(hints).length ? hints : null;
}

interface NativeDetector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}

/** Native BarcodeDetector (Android Chrome) with zxing-wasm fallback (iOS Safari). */
export async function readCodes(image: ImageBitmap, original: Blob): Promise<RawCode[]> {
  const Detector = (globalThis as { BarcodeDetector?: new () => NativeDetector })
    .BarcodeDetector;
  if (Detector) {
    try {
      const found = await new Detector().detect(image);
      return found.map((f) => ({ format: f.format, text: f.rawValue }));
    } catch {
      // fall through to wasm
    }
  }
  try {
    const { readBarcodes } = await import('./zxing');
    const results = await readBarcodes(original, { tryHarder: true, maxNumberOfSymbols: 4 });
    return results.filter((r) => r.isValid).map((r) => ({ format: r.format, text: r.text }));
  } catch {
    return [];
  }
}
