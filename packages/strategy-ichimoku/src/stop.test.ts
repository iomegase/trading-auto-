import { asDecimalString, type DecimalString } from '@trading-auto/domain';
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

function price(value: string): DecimalString {
  return asDecimalString(value);
}

describe('proposeKijunStop', () => {
  it('proposes an aligned LONG stop strictly below the entry reference', () => {
    expect(
      proposeKijunStop('LONG', price('99.5'), price('100'), price('0.1')),
    ).toEqual({ status: 'VALID', price: '99.5' });
  });

  it('proposes an aligned SHORT stop strictly above the entry reference', () => {
    expect(
      proposeKijunStop('SHORT', price('100.5'), price('100'), price('0.1')),
    ).toEqual({ status: 'VALID', price: '100.5' });
  });

  it.each([
    { label: 'equal LONG stop', direction: 'LONG' as const, kijun: '100' },
    {
      label: 'LONG stop above entry',
      direction: 'LONG' as const,
      kijun: '101',
    },
    { label: 'equal SHORT stop', direction: 'SHORT' as const, kijun: '100' },
    {
      label: 'SHORT stop below entry',
      direction: 'SHORT' as const,
      kijun: '99',
    },
    { label: 'zero Kijun', direction: 'LONG' as const, kijun: '0' },
    { label: 'negative Kijun', direction: 'LONG' as const, kijun: '-1' },
  ])('rejects an invalid $label', ({ direction, kijun }) => {
    expect(
      proposeKijunStop(direction, price(kijun), price('100'), price('0.1')),
    ).toEqual({ status: 'INVALID_INITIAL_STOP' });
  });

  it('rejects a missing Kijun', () => {
    expect(proposeKijunStop('LONG', null, price('100'), price('0.1'))).toEqual({
      status: 'INVALID_INITIAL_STOP',
    });
  });

  it('rejects a malformed runtime Kijun as an invalid initial stop', () => {
    expect(
      proposeKijunStop(
        'LONG',
        '1e0' as DecimalString,
        price('100'),
        price('0.1'),
      ),
    ).toEqual({ status: 'INVALID_INITIAL_STOP' });
  });

  it('rounds a LONG stop upward to the next tick', () => {
    expect(
      proposeKijunStop('LONG', price('99.501'), price('100'), price('0.01')),
    ).toEqual({ status: 'VALID', price: '99.51' });
  });

  it('rounds a SHORT stop downward to the previous tick', () => {
    expect(
      proposeKijunStop('SHORT', price('100.509'), price('100'), price('0.01')),
    ).toEqual({ status: 'VALID', price: '100.5' });
  });

  it.each([
    {
      direction: 'LONG' as const,
      kijun: '1',
      entry: '4',
      expected: '3',
    },
    {
      direction: 'SHORT' as const,
      kijun: '5',
      entry: '1',
      expected: '3',
    },
  ])(
    'rounds a repeating $direction tick quotient with bounded precision',
    ({ direction, kijun, entry, expected }) => {
      expect(
        proposeKijunStop(direction, price(kijun), price(entry), price('3')),
      ).toEqual({ status: 'VALID', price: expected });
    },
  );

  it('rejects a LONG stop when tick rounding reaches the entry', () => {
    expect(
      proposeKijunStop('LONG', price('99.999'), price('100'), price('1')),
    ).toEqual({ status: 'INVALID_INITIAL_STOP' });
  });

  it('returns canonical decimal notation for a tiny exact Kijun', () => {
    expect(
      proposeKijunStop(
        'LONG',
        price('0.0000001'),
        price('0.0000002'),
        price('0.0000001'),
      ),
    ).toEqual({ status: 'VALID', price: '0.0000001' });
  });

  it.each([
    { field: 'entryReference', entry: '0', tick: '0.1' },
    { field: 'entryReference', entry: '-1', tick: '0.1' },
    { field: 'tickSize', entry: '100', tick: '0' },
    { field: 'tickSize', entry: '100', tick: '-0.1' },
  ])('rejects a non-positive $field', ({ entry, tick }) => {
    expect(() =>
      proposeKijunStop('LONG', price('99'), price(entry), price(tick)),
    ).toThrow(RangeError);
  });

  it.each([
    { field: 'entryReference', entry: '100e0', tick: '0.1' },
    { field: 'tickSize', entry: '100', tick: '1e-1' },
  ])('rejects a malformed runtime $field', ({ entry, tick }) => {
    expect(() =>
      proposeKijunStop(
        'LONG',
        price('99'),
        entry as DecimalString,
        tick as DecimalString,
      ),
    ).toThrow(RangeError);
  });

  it('rejects an invalid runtime direction', () => {
    expect(() =>
      proposeKijunStop(
        'SIDEWAYS' as unknown as 'LONG',
        price('99'),
        price('100'),
        price('0.1'),
      ),
    ).toThrow(/direction/);
  });

  it('is isolated from ambient Decimal exponent configuration', () => {
    const previousConfiguration = decimalConfiguration();

    try {
      Decimal.set({ maxE: 2, minE: -2 });

      expect(
        proposeKijunStop('SHORT', price('1000'), price('999'), price('0.1')),
      ).toEqual({ status: 'VALID', price: '1000' });
    } finally {
      Decimal.set(previousConfiguration);
    }
  });
});
