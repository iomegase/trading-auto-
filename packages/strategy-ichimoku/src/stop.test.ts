import { asDecimalString } from '@trading-auto/domain';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { proposeKijunStop } from './index.js';

function decimalConfiguration() {
  return {
    precision: Decimal.precision,
    rounding: Decimal.rounding,
    toExpNeg: Decimal.toExpNeg,
    toExpPos: Decimal.toExpPos,
    maxE: Decimal.maxE,
    minE: Decimal.minE,
    modulo: Decimal.modulo,
    crypto: Decimal.crypto,
  };
}

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

  it.each([0, -1])('rejects a non-positive Kijun %s', (kijun) => {
    expect(proposeKijunStop('LONG', kijun, asDecimalString('100'))).toEqual({
      status: 'INVALID_INITIAL_STOP',
    });
  });

  it('rejects an invalid runtime direction', () => {
    expect(() =>
      proposeKijunStop(
        'SIDEWAYS' as unknown as 'LONG',
        99,
        asDecimalString('100'),
      ),
    ).toThrow(/direction/);
  });

  it('is isolated from ambient Decimal exponent configuration', () => {
    const previousConfiguration = decimalConfiguration();

    try {
      Decimal.set({ maxE: 2, minE: -2 });

      expect(proposeKijunStop('SHORT', 1000, asDecimalString('999'))).toEqual({
        status: 'VALID',
        price: '1000',
      });
    } finally {
      Decimal.set(previousConfiguration);
    }
  });
});
