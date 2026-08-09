import { asDecimalString, type Candle } from '@trading-auto/domain';
import type { IchimokuPoint } from '@trading-auto/indicators';
import { buildCandle } from '@trading-auto/test-helpers';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { evaluateH4Regime } from './index.js';

function h4Candle(close: string): Readonly<Candle> {
  return buildCandle({
    timeframe: '4h',
    open: close,
    high: close,
    low: close,
    close,
  });
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

function ichimokuPoint(
  candle: Readonly<Candle>,
  overrides: Partial<IchimokuPoint> = {},
): Readonly<IchimokuPoint> {
  return {
    instrumentId: candle.instrumentId,
    timeframe: candle.timeframe,
    candleCloseTime: candle.closeTime,
    computedAt: candle.availableAt,
    configVersion: 'regime-test-v1',
    tenkan: 95,
    kijun: 96,
    kijunPrice: asDecimalString('96'),
    senkouARaw: 101,
    senkouBRaw: 99,
    projectedSenkouA: 101,
    projectedSenkouB: 99,
    currentCloudA: 100,
    currentCloudB: 90,
    currentCloudTop: 100,
    currentCloudBottom: 90,
    projectedCloudTop: 101,
    projectedCloudBottom: 99,
    projectedCloudDirection: 'BULLISH',
    chikouReferenceIndex: 1,
    chikouReferenceClose: 95,
    chikouReferenceHigh: 96,
    chikouReferenceLow: 94,
    kijunSlope: 1,
    ...overrides,
  };
}

describe('evaluateH4Regime', () => {
  it('returns BULLISH when price, slope, and projected cloud are bullish', () => {
    const candle = h4Candle('101');

    expect(evaluateH4Regime(candle, ichimokuPoint(candle))).toBe('BULLISH');
  });

  it('returns BEARISH when price, slope, and projected cloud are bearish', () => {
    const candle = h4Candle('89');
    const point = ichimokuPoint(candle, {
      kijunSlope: -1,
      projectedCloudDirection: 'BEARISH',
    });

    expect(evaluateH4Regime(candle, point)).toBe('BEARISH');
  });

  it.each([
    {
      label: 'price is not above the cloud',
      close: '99',
      overrides: {},
    },
    {
      label: 'Kijun slope is not positive',
      close: '101',
      overrides: { kijunSlope: 0 },
    },
    {
      label: 'projected cloud is not bullish',
      close: '101',
      overrides: { projectedCloudDirection: 'NEUTRAL' as const },
    },
    {
      label: 'price is not below the cloud',
      close: '91',
      overrides: {
        kijunSlope: -1,
        projectedCloudDirection: 'BEARISH' as const,
      },
    },
    {
      label: 'Kijun slope is not negative',
      close: '89',
      overrides: {
        kijunSlope: 0,
        projectedCloudDirection: 'BEARISH' as const,
      },
    },
    {
      label: 'projected cloud is not bearish',
      close: '89',
      overrides: {
        kijunSlope: -1,
        projectedCloudDirection: 'NEUTRAL' as const,
      },
    },
  ])('returns NEUTRAL when $label', ({ close, overrides }) => {
    const candle = h4Candle(close);

    expect(evaluateH4Regime(candle, ichimokuPoint(candle, overrides))).toBe(
      'NEUTRAL',
    );
  });

  it.each([
    { label: 'cloud top', overrides: { currentCloudTop: null } },
    { label: 'cloud bottom', overrides: { currentCloudBottom: null } },
    { label: 'Kijun slope', overrides: { kijunSlope: null } },
    {
      label: 'projected cloud direction',
      overrides: { projectedCloudDirection: 'INSUFFICIENT_DATA' as const },
    },
  ])(
    'returns INSUFFICIENT_DATA when $label is unavailable',
    ({ overrides }) => {
      const candle = h4Candle('101');

      expect(evaluateH4Regime(candle, ichimokuPoint(candle, overrides))).toBe(
        'INSUFFICIENT_DATA',
      );
    },
  );

  it.each([
    {
      label: 'cloud top',
      close: '100',
      overrides: {},
    },
    {
      label: 'cloud bottom',
      close: '90',
      overrides: {
        kijunSlope: -1,
        projectedCloudDirection: 'BEARISH' as const,
      },
    },
  ])('treats equality with the $label as NEUTRAL', ({ close, overrides }) => {
    const candle = h4Candle(close);

    expect(evaluateH4Regime(candle, ichimokuPoint(candle, overrides))).toBe(
      'NEUTRAL',
    );
  });

  it('compares a huge DecimalString close without converting it to Number', () => {
    const close = `1${'0'.repeat(400)}`;
    const candle = h4Candle(close);
    const point = ichimokuPoint(candle, {
      currentCloudTop: Number.MAX_VALUE,
    });

    expect(evaluateH4Regime(candle, point)).toBe('BULLISH');
  });

  it('is isolated from ambient Decimal exponent configuration', () => {
    const previousConfiguration = decimalConfiguration();
    const candle = h4Candle('1001');
    const point = ichimokuPoint(candle, {
      currentCloudTop: 1000,
      currentCloudBottom: 900,
    });

    try {
      Decimal.set({ maxE: 2, minE: -2 });

      expect(evaluateH4Regime(candle, point)).toBe('BULLISH');
    } finally {
      Decimal.set(previousConfiguration);
    }
  });

  it.each([
    {
      label: 'cloud top',
      overrides: { currentCloudTop: Number.POSITIVE_INFINITY },
    },
    {
      label: 'cloud bottom',
      overrides: { currentCloudBottom: Number.NEGATIVE_INFINITY },
    },
    { label: 'Kijun slope', overrides: { kijunSlope: Number.NaN } },
  ])('rejects a non-finite $label', ({ overrides }) => {
    const candle = h4Candle('101');

    expect(() =>
      evaluateH4Regime(candle, ichimokuPoint(candle, overrides)),
    ).toThrow(RangeError);
  });

  it('rejects a non-finite required number even when another field is unavailable', () => {
    const candle = h4Candle('101');
    const point = ichimokuPoint(candle, {
      currentCloudTop: Number.POSITIVE_INFINITY,
      currentCloudBottom: null,
    });

    expect(() => evaluateH4Regime(candle, point)).toThrow(RangeError);
  });
});
