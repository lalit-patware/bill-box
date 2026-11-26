import { describe, expect, it } from 'vitest';

import { afterEdit } from './useBill';

const validation = {
  items_sum: 3648,
  total_mismatch: true,
  mismatch_amount: 64,
  line_mismatches: [],
  low_confidence_fields: ['vendor_name', 'total'],
};

describe('afterEdit', () => {
  it('clears the fixed field but keeps Fix while others remain', () => {
    const r = afterEdit({ validation, total_mismatch: true }, 'vendor_name');
    expect(r.validation?.low_confidence_fields).toEqual(['total']);
    expect(r.needs_fix).toBe(true);
    expect(r.total_mismatch).toBe(true);
  });

  it('fixing the total also clears the mismatch flag', () => {
    const r = afterEdit({ validation: { ...validation, low_confidence_fields: ['total'] }, total_mismatch: true }, 'total');
    expect(r).toMatchObject({ needs_fix: false, total_mismatch: false });
    expect(r.validation?.total_mismatch).toBe(false);
  });

  it('works for fallback bills without validation', () => {
    expect(afterEdit({ validation: null, total_mismatch: false }, 'bill_date')).toEqual({
      validation: null,
      needs_fix: false,
      total_mismatch: false,
    });
  });
});
