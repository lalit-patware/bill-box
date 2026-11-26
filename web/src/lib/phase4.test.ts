import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { buildClaimPack, complaintText, serviceSearchUrl } from '../features/review/claim';
import { buildActionItems } from '../features/vault/actionItems';
import { monthStart, openDues, upiLink } from '../features/vendors/ledger';
import { urlBase64ToUint8Array } from './push';

const vendors = [
  { id: 'v1', name: 'Dudhwala – Ramesh', phone: null, upi_vpa: 'ramesh@ybl', category: 'milk', is_recurring: true },
  { id: 'v2', name: 'Dhobi', phone: null, upi_vpa: null, category: 'laundry', is_recurring: true },
];

describe('ledger', () => {
  it('lists unpaid balances, biggest first, skipping paid months', () => {
    const dues = openDues(vendors, [
      { id: 'l1', vendor_id: 'v1', month: '2026-11-01', amount_due: 3712, amount_paid: 0, paid_on: null },
      { id: 'l2', vendor_id: 'v1', month: '2026-10-01', amount_due: 3500, amount_paid: 3500, paid_on: '2026-11-02' },
      { id: 'l3', vendor_id: 'v2', month: '2026-11-01', amount_due: 400, amount_paid: 100, paid_on: null },
      { id: 'l4', vendor_id: 'gone', month: '2026-11-01', amount_due: 99, amount_paid: 0, paid_on: null },
    ]);
    expect(dues.map((d) => [d.vendor.id, d.balance])).toEqual([
      ['v1', 3712],
      ['v2', 300],
    ]);
  });

  it('builds a UPI deep link with amount', () => {
    const link = upiLink('ramesh@ybl', 'Dudhwala Ramesh', 3712, 'Nov 2026 bill');
    expect(link.startsWith('upi://pay?')).toBe(true);
    const q = new URLSearchParams(link.slice('upi://pay?'.length));
    expect(q.get('pa')).toBe('ramesh@ybl');
    expect(q.get('am')).toBe('3712.00');
    expect(q.get('cu')).toBe('INR');
  });

  it('month start', () => {
    expect(monthStart(new Date(2026, 10, 26))).toBe('2026-11-01');
  });
});

describe('action items (phase 4)', () => {
  it('adds laundry pending and vendor dues after deadlines', () => {
    const items = buildActionItems(
      [],
      [{ bill_id: 'b1', name: 'Shirt', exchange_until: '2026-11-28', warranty_until: null, vendor_name: 'Zudio' }],
      new Date(2026, 10, 26),
      [{ vendorId: 'v1', name: 'Milk', balance: 3712 }],
      [{ id: 'l1', vendor_name: 'Dhobi', created_at: '2026-11-23T10:00:00Z', pieces: 12 }],
    );
    expect(items.map((i) => i.kind)).toEqual(['exchange', 'laundry', 'due']);
    expect(items[2]).toMatchObject({ amount: 3712, vendorId: 'v1' });
  });
});

describe('claim helper', () => {
  const input = {
    vendor: 'Croma',
    billDate: '2026-01-10',
    billNo: 'CR-123',
    total: 32990,
    product: 'LG Fridge 260L',
    serial: 'SN998',
    warrantyUntil: '2027-01-09',
  };

  it('writes complaint text with only known facts', () => {
    const text = complaintText(input);
    expect(text).toContain('LG Fridge 260L from Croma');
    expect(text).toContain('Serial / IMEI: SN998');
    expect(text).toContain('Bill / invoice no: CR-123');
    expect(text).not.toMatch(/\d{10}/); // never a made-up phone number
  });

  it('omits missing details', () => {
    const text = complaintText({ ...input, serial: null, billNo: null });
    expect(text).not.toContain('Serial');
    expect(text).not.toContain('invoice no');
  });

  it('service search link', () => {
    expect(serviceSearchUrl('LG Fridge')).toContain('LG%20Fridge');
  });

  it('builds a claim pack PDF: summary + image page + merged PDF pages', async () => {
    const src = await PDFDocument.create();
    src.addPage();
    src.addPage();
    const pdfBytes = await src.save();
    // 1×1 white JPEG
    const jpg = Uint8Array.from(
      atob(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AP//Z',
      ),
      (c) => c.charCodeAt(0),
    );
    const out = await buildClaimPack(['Croma', 'Total: ₹32,990 हिंदी'], [
      { bytes: jpg, type: 'jpg' },
      { bytes: pdfBytes, type: 'pdf' },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
  });
});

describe('push', () => {
  it('decodes VAPID key (url-safe base64)', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID-_8'))).toEqual([1, 2, 3, 251, 255]);
  });
});
