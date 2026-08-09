import type { Candle } from '@trading-auto/domain';
import { buildCandle } from '@trading-auto/test-helpers';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { detectBreakout } from './index.js';

function candle(high: string, low: string, close: string): Readonly<Candle> {
  return buildCandle({ open: close, high, low, close });
}

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

describe('detectBreakout', () => {
  it('returns LONG when the close is strictly above every prior high', () => {
    const candles = [
      candle('100', '90', '95'),
      candle('102', '92', '100'),
      candle('104', '94', '103'),
      candle('106', '96', '105'),
    ];

    expect(detectBreakout(candles, 3, 3)).toEqual({ status: 'LONG' });
  });

  it('returns SHORT when the close is strictly below every prior low', () => {
    const candles = [
      candle('110', '100', '105'),
      candle('108', '98', '101'),
      candle('106', '96', '100'),
      candle('95', '94', '95'),
    ];

    expect(detectBreakout(candles, 3, 3)).toEqual({ status: 'SHORT' });
  });

  it.each([
    {
      label: 'prior high',
      candles: [candle('100', '90', '95'), candle('101', '99', '100')],
    },
    {
      label: 'prior low',
      candles: [candle('100', '90', '95'), candle('91', '89', '90')],
    },
  ])('returns NONE when the close equals the $label', ({ candles }) => {
    expect(detectBreakout(candles, 1, 1)).toEqual({ status: 'NONE' });
  });

  it('excludes the current candle high from the comparison window', () => {
    const candles = [candle('100', '90', '95'), candle('101', '99', '100.5')];

    expect(detectBreakout(candles, 1, 1)).toEqual({ status: 'LONG' });
  });

  it('excludes the current candle low from the comparison window', () => {
    const candles = [candle('100', '90', '95'), candle('89.5', '89', '89.5')];

    expect(detectBreakout(candles, 1, 1)).toEqual({ status: 'SHORT' });
  });

  it('returns INSUFFICIENT_DATA when fewer than lookback candles precede the index', () => {
    const candles = [candle('100', '90', '95'), candle('101', '91', '96')];

    expect(detectBreakout(candles, 1, 2)).toEqual({
      status: 'INSUFFICIENT_DATA',
    });
  });

  it('compares huge canonical decimal prices exactly', () => {
    const priorHigh = `1${'0'.repeat(400)}`;
    const breakoutClose = `1${'0'.repeat(399)}1`;
    const candles = [
      candle(priorHigh, '1', priorHigh),
      candle(breakoutClose, '1', breakoutClose),
    ];

    expect(detectBreakout(candles, 1, 1)).toEqual({ status: 'LONG' });
  });

  it('compares tiny canonical decimal prices exactly', () => {
    const priorLow = `0.${'0'.repeat(399)}2`;
    const breakoutClose = `0.${'0'.repeat(399)}1`;
    const candles = [
      candle('1', priorLow, priorLow),
      candle('1', breakoutClose, breakoutClose),
    ];

    expect(detectBreakout(candles, 1, 1)).toEqual({ status: 'SHORT' });
  });

  it('is isolated from ambient Decimal exponent configuration', () => {
    const previousConfiguration = decimalConfiguration();
    const candles = [
      candle('1000', '900', '950'),
      candle('1001', '900', '1001'),
    ];

    try {
      Decimal.set({ maxE: 2, minE: -2 });

      expect(detectBreakout(candles, 1, 1)).toEqual({ status: 'LONG' });
    } finally {
      Decimal.set(previousConfiguration);
    }
  });

  it('rejects a sparse candle array when the lookback encounters a hole', () => {
    const candles = new Array<Candle>(3);
    candles[0] = candle('100', '90', '95');
    candles[2] = candle('102', '92', '101');

    expect(() => detectBreakout(candles, 2, 2)).toThrow(RangeError);
  });

  it('does not mutate the candle array or its candles', () => {
    const candles = [candle('100', '90', '95'), candle('101', '91', '96')];
    const arrayBefore = [...candles];
    const valuesBefore = candles.map((item) => ({ ...item }));

    detectBreakout(candles, 1, 1);

    expect(candles).toEqual(arrayBefore);
    expect(candles[0]).toBe(arrayBefore[0]);
    expect(candles[1]).toBe(arrayBefore[1]);
    expect(candles).toEqual(valuesBefore);
  });

  it.each([-1, 1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid index %s',
    (index) => {
      expect(() =>
        detectBreakout([candle('100', '90', '95')], index, 1),
      ).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid lookback %s',
    (lookback) => {
      expect(() =>
        detectBreakout([candle('100', '90', '95')], 0, lookback),
      ).toThrow(RangeError);
    },
  );
});
