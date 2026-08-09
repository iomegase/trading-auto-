import { asDecimalString } from '@trading-auto/domain';
import { describe, expect, it } from 'vitest';

import { proposeKijunStop } from './index.js';

describe('proposeKijunStop', () => {
  it('proposes a valid LONG stop strictly below the entry reference', () => {
    expect(proposeKijunStop('LONG', 99.5, asDecimalString('100'))).toEqual({
      status: 'VALID',
      price: '99.5',
    });
  });

  it('proposes a valid SHORT stop strictly above the entry reference', () => {
    expect(proposeKijunStop('SHORT', 100.5, asDecimalString('100'))).toEqual({
      status: 'VALID',
      price: '100.5',
    });
  });

  it.each([
    { label: 'equal LONG stop', direction: 'LONG' as const, kijun: 100 },
    { label: 'LONG stop above entry', direction: 'LONG' as const, kijun: 101 },
    { label: 'equal SHORT stop', direction: 'SHORT' as const, kijun: 100 },
    { label: 'SHORT stop below entry', direction: 'SHORT' as const, kijun: 99 },
    { label: 'missing Kijun', direction: 'LONG' as const, kijun: null },
    {
      label: 'positive infinite Kijun',
      direction: 'LONG' as const,
      kijun: Number.POSITIVE_INFINITY,
    },
    {
      label: 'negative infinite Kijun',
      direction: 'SHORT' as const,
      kijun: Number.NEGATIVE_INFINITY,
    },
    { label: 'NaN Kijun', direction: 'LONG' as const, kijun: Number.NaN },
  ])('rejects an invalid $label', ({ direction, kijun }) => {
    expect(proposeKijunStop(direction, kijun, asDecimalString('100'))).toEqual({
      status: 'INVALID_INITIAL_STOP',
    });
  });

  it('returns canonical decimal notation for an exponent-like Kijun', () => {
    expect(
      proposeKijunStop('LONG', 1e-7, asDecimalString('0.0000002')),
    ).toEqual({ status: 'VALID', price: '0.0000001' });
  });
});
