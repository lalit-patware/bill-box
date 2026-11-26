import { describe, expect, it } from 'vitest';

import { type ActionBill, buildActionItems } from '../features/vault/actionItems';
import { DUPLICATE_MAX_DISTANCE, dhashFromGray, findDuplicate, hamming } from './dhash';
import { isEmptyQuery, parseQuery } from './searchQuery';

describe('dhash', () => {
  const ramp = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20); // left > right everywhere
  it('encodes gradients as 64 bits', () => {
    expect(dhashFromGray(ramp)).toBe('ffffffffffffffff');
    expect(dhashFromGray(ramp.map((v) => 255 - v))).toBe('0000000000000000');
  });
  it('hamming distance', () => {
    expect(hamming('ffffffffffffffff', 'fffffffffffffffe')).toBe(1);
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });
  it('finds a near-identical bill and ignores different ones', () => {
    const known = [
      { id: 'a', image_hash: 'ffffffffffffff00', vendor_name: 'Zudio', bill_date: null, created_at: '' },
      { id: 'b', image_hash: '0f0f0f0f0f0f0f0f', vendor_name: 'Milk', bill_date: null, created_at: '' },
      { id: 'c', image_hash: null, vendor_name: null, bill_date: null, created_at: '' },
    ];
    expect(findDuplicate('ffffffffffffff03', known)?.id).toBe('a'); // 2 bits off
    expect(findDuplicate('aaaaaaaaaaaaaaaa', known)).toBeNull();
    expect(DUPLICATE_MAX_DISTANCE).toBeLessThan(10);
  });
});

describe('parseQuery', () => {
  it('reads kinds, months and words', () => {
    expect(parseQuery('Milk October')).toEqual({ words: [], kinds: ['recurring_milk'], month: 10, year: null });
    expect(parseQuery('blue shirt ZUDIO')).toEqual({
      words: ['blue', 'shirt', 'zudio'],
      kinds: [],
      month: null,
      year: null,
    });
    expect(parseQuery('fridge warranty 2026')).toEqual({
      words: ['fridge'],
      kinds: ['electronics'],
      month: null,
      year: 2026,
    });
  });
  it('understands Hindi and Hinglish', () => {
    expect(parseQuery('दूध नवंबर')).toMatchObject({ kinds: ['recurring_milk'], month: 11 });
    expect(parseQuery('dhobi ka bill')).toMatchObject({ kinds: ['laundry'], words: [] });
  });
  it('ignores punctuation and stop words', () => {
    expect(parseQuery('  the bill, for   Croma!! ').words).toEqual(['croma']);
    expect(isEmptyQuery(parseQuery('  bill  '))).toBe(true);
  });
});

describe('buildActionItems', () => {
  const today = new Date(2026, 10, 26); // 26 Nov 2026
  const bill = (over: Partial<ActionBill>): ActionBill => ({
    id: 'x',
    vendor_name: 'Shop',
    needs_fix: false,
    ai_pending: false,
    confirmed_at: null,
    duplicate_of: null,
    status: 'done',
    ...over,
  });

  it('orders deadlines first, then fixes, duplicates and pending', () => {
    const items = buildActionItems(
      [
        bill({ id: 'f', needs_fix: true }),
        bill({ id: 'd', duplicate_of: 'f' }),
        bill({ id: 'p1', ai_pending: true }),
        bill({ id: 'p2', ai_pending: true, needs_fix: true }),
        bill({ id: 'ok', needs_fix: true, confirmed_at: '2026-11-20' }),
      ],
      [
        { bill_id: 'w', name: 'Fridge', warranty_until: '2026-12-20', exchange_until: null, vendor_name: 'Croma' },
        { bill_id: 'z', name: null, warranty_until: null, exchange_until: '2026-11-28', vendor_name: 'Zudio' },
        { bill_id: 'old', name: null, warranty_until: '2026-11-01', exchange_until: '2027-01-30', vendor_name: 'X' },
      ],
      today,
    );
    expect(items).toEqual([
      { kind: 'exchange', billId: 'z', label: 'Zudio', days: 2 },
      { kind: 'warranty', billId: 'w', label: 'Croma', days: 24 },
      { kind: 'fix', billId: 'f', label: 'Shop' },
      { kind: 'duplicate', billId: 'd', label: 'Shop' },
      { kind: 'pending', count: 2 },
    ]);
  });
});
