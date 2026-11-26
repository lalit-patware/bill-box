import { describe, expect, it } from 'vitest';

import { buildHints, parseGstQr, parseUpi } from './codes';

function jwtWith(payload: object): string {
  const b64url = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`;
}

describe('parseUpi', () => {
  it('reads payee VPA, name and amount', () => {
    expect(parseUpi('upi://pay?pa=ramesh.dudh@okaxis&pn=Ramesh%20Dudhwala&am=3712&cu=INR')).toEqual({
      pa: 'ramesh.dudh@okaxis',
      pn: 'Ramesh Dudhwala',
      am: '3712',
    });
  });
  it('ignores non-UPI and missing pa', () => {
    expect(parseUpi('https://example.com')).toBeNull();
    expect(parseUpi('upi://pay?pn=NoVpa')).toBeNull();
  });
});

describe('parseGstQr', () => {
  const invoice = {
    SellerGstin: '23AAACR5055K1Z7',
    BuyerGstin: 'URP',
    DocNo: 'INV/26/0042',
    DocTyp: 'INV',
    DocDt: '03/11/2026',
    TotInvVal: 54999,
    ItemCnt: 1,
    Irn: 'abc123',
  };
  it('decodes the e-invoice payload in a "data" string', () => {
    const hint = parseGstQr(jwtWith({ data: JSON.stringify(invoice), iss: 'NIC' }));
    expect(hint).toMatchObject({ sellerGstin: '23AAACR5055K1Z7', docNo: 'INV/26/0042', totalValue: 54999 });
  });
  it('decodes a flat payload', () => {
    expect(parseGstQr(jwtWith(invoice))?.docDate).toBe('03/11/2026');
  });
  it('rejects random text and unrelated JWTs', () => {
    expect(parseGstQr('hello')).toBeNull();
    expect(parseGstQr(jwtWith({ sub: 'x' }))).toBeNull();
  });
});

describe('buildHints', () => {
  it('splits UPI, GST and plain barcodes, dedupes', () => {
    const hints = buildHints([
      { format: 'QRCode', text: 'upi://pay?pa=shop@ybl&pn=Shop' },
      { format: 'EAN-13', text: '8901234567890' },
      { format: 'EAN-13', text: '8901234567890' },
      { format: 'Code128', text: 'SN-XYZ-123' },
    ]);
    expect(hints?.upi?.pa).toBe('shop@ybl');
    expect(hints?.barcodes).toEqual([
      { format: 'EAN-13', text: '8901234567890' },
      { format: 'Code128', text: 'SN-XYZ-123' },
    ]);
  });
  it('returns null when nothing useful', () => {
    expect(buildHints([])).toBeNull();
  });
});
