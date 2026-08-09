import type { Candle, CandleInput, InstantString } from '@trading-auto/domain';
import { buildCandle } from '@trading-auto/test-helpers';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  computeIchimoku,
  type IchimokuConfig,
  type IchimokuPoint,
} from './index.js';

const baselineConfig: IchimokuConfig = {
  version: 'baseline-9-26-52-v1',
  tenkanPeriod: 9,
  kijunPeriod: 26,
  senkouBPeriod: 52,
  displacement: 26,
  kijunSlopeLookback: 3,
};

function timestampAt(hour: number): string {
  return new Date(Date.UTC(2026, 0, 1, hour)).toISOString();
}

function candleAt(
  index: number,
  prices: Readonly<{
    high: number;
    low: number;
    close: number;
  }>,
): Readonly<Candle> {
  const openTime = timestampAt(index);
  const closeTime = timestampAt(index + 1);

  return buildCandle({
    sourceTimestamp: openTime,
    openTime,
    closeTime,
    availableAt: closeTime,
    ingestedAt: closeTime,
    open: String(prices.close),
    high: String(prices.high),
    low: String(prices.low),
    close: String(prices.close),
  });
}

function candleFromStrings(
  index: number,
  prices: Readonly<{
    high: string;
    low: string;
    close: string;
  }>,
): Readonly<Candle> {
  const openTime = timestampAt(index);
  const closeTime = timestampAt(index + 1);

  return buildCandle({
    sourceTimestamp: openTime,
    openTime,
    closeTime,
    availableAt: closeTime,
    ingestedAt: closeTime,
    open: prices.close,
    high: prices.high,
    low: prices.low,
    close: prices.close,
  });
}

function trendingCandles(
  length: number,
  closeAt: (index: number) => number = (index) => index + 10,
): readonly Readonly<Candle>[] {
  return Array.from({ length }, (_, index) => {
    const close = closeAt(index);

    return candleAt(index, { high: close + 1, low: close - 1, close });
  });
}

function firstNonNullIndex(
  points: readonly IchimokuPoint[],
  field: keyof IchimokuPoint,
): number {
  return points.findIndex((point) => point[field] !== null);
}

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new RangeError(`Expected an item at index ${String(index)}.`);
  }

  return item;
}

describe('computeIchimoku', () => {
  it.each([undefined, '', '   '])(
    'rejects invalid config version %j',
    (version) => {
      const config = { ...baselineConfig, version } as IchimokuConfig;

      expect(() => computeIchimoku([], config)).toThrow(/version/i);
    },
  );

  it('records candle and configuration provenance on every point', () => {
    const candle = candleAt(0, { high: 11, low: 9, close: 10 });
    const point = itemAt(computeIchimoku([candle], baselineConfig), 0);

    expect(point).toMatchObject({
      instrumentId: candle.instrumentId,
      timeframe: candle.timeframe,
      candleCloseTime: candle.closeTime,
      configVersion: baselineConfig.version,
    });
  });

  it('canonicalizes runtime candle instants in point provenance', () => {
    const canonical = candleAt(0, { high: 11, low: 9, close: 10 });
    const candle = {
      ...canonical,
      closeTime: '2026-01-01T02:00:00+01:00' as InstantString,
      availableAt: '2026-01-01T02:00:00+01:00' as InstantString,
    };
    const point = itemAt(computeIchimoku([candle], baselineConfig), 0);

    expect(point.candleCloseTime).toBe('2026-01-01T01:00:00Z');
    expect(point.computedAt).toBe('2026-01-01T01:00:00Z');
  });

  it('uses the latest prefix availability as computedAt', () => {
    const first = buildCandle({
      openTime: '2026-01-01T08:00:00Z',
      closeTime: '2026-01-01T09:00:00Z',
      availableAt: '2026-01-01T11:00:00Z',
      ingestedAt: '2026-01-01T11:00:00Z',
    });
    const second = buildCandle({
      openTime: '2026-01-01T09:00:00Z',
      closeTime: '2026-01-01T10:00:00Z',
      availableAt: '2026-01-01T10:00:00Z',
      ingestedAt: '2026-01-01T10:00:00Z',
    });

    expect(
      itemAt(computeIchimoku([first, second], baselineConfig), 1).computedAt,
    ).toBe(first.availableAt);
  });

  it('preserves an exact decimal Kijun midpoint', () => {
    const config: IchimokuConfig = {
      version: 'exact-kijun-v1',
      tenkanPeriod: 1,
      kijunPeriod: 1,
      senkouBPeriod: 1,
      displacement: 1,
      kijunSlopeLookback: 1,
    };
    const candle = candleFromStrings(0, {
      high: '0.2',
      low: '0.1',
      close: '0.15',
    });

    expect(itemAt(computeIchimoku([candle], config), 0).kijunPrice).toBe(
      '0.15',
    );
  });

  it('isolates exact Kijun calculation from ambient Decimal settings', () => {
    const previous = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
      maxE: Decimal.maxE,
      minE: Decimal.minE,
      modulo: Decimal.modulo,
      crypto: Decimal.crypto,
    };
    const config: IchimokuConfig = {
      ...baselineConfig,
      version: 'decimal-isolation-v1',
      tenkanPeriod: 1,
      kijunPeriod: 1,
      senkouBPeriod: 1,
      displacement: 1,
      kijunSlopeLookback: 1,
    };
    const candle = candleFromStrings(0, {
      high: '1002',
      low: '1000',
      close: '1001',
    });

    try {
      Decimal.set({ maxE: 2, minE: -2 });
      expect(itemAt(computeIchimoku([candle], config), 0).kijunPrice).toBe(
        '1001',
      );
    } finally {
      Decimal.set(previous);
    }
  });

  it('rejects a sparse input before calculating points', () => {
    const candles = new Array<Candle>(1);

    expect(() => computeIchimoku(candles, baselineConfig)).toThrow(/dense/i);
  });

  it.each([
    [
      'mixed instruments',
      [
        candleAt(0, { high: 11, low: 9, close: 10 }),
        buildCandle({
          instrumentId: 'OTHER',
          openTime: timestampAt(1),
          closeTime: timestampAt(2),
          availableAt: timestampAt(2),
          ingestedAt: timestampAt(2),
        }),
      ],
    ],
    [
      'mixed timeframes',
      [
        candleAt(0, { high: 11, low: 9, close: 10 }),
        buildCandle({
          timeframe: '4h',
          openTime: timestampAt(1),
          closeTime: timestampAt(2),
          availableAt: timestampAt(2),
          ingestedAt: timestampAt(2),
        }),
      ],
    ],
    [
      'overlapping candles',
      [
        candleAt(0, { high: 11, low: 9, close: 10 }),
        buildCandle({
          openTime: '2026-01-01T00:30:00Z',
          closeTime: timestampAt(2),
          availableAt: timestampAt(2),
          ingestedAt: timestampAt(2),
        }),
      ],
    ],
    [
      'unordered candles',
      [
        candleAt(1, { high: 12, low: 10, close: 11 }),
        candleAt(0, { high: 11, low: 9, close: 10 }),
      ],
    ],
  ] as const)('rejects $0', (_label, candles) => {
    expect(() => computeIchimoku(candles, baselineConfig)).toThrow(RangeError);
  });

  it('rejects a positive price that underflows to zero as a number', () => {
    const tiny = `0.${'0'.repeat(399)}1`;

    expect(() =>
      computeIchimoku(
        [buildCandle({ open: tiny, high: tiny, low: tiny, close: tiny })],
        baselineConfig,
      ),
    ).toThrow(/representable/);
  });
  it('starts every baseline line at the exact inclusive-window index', () => {
    const points = computeIchimoku(trendingCandles(90), baselineConfig);

    expect(points).toHaveLength(90);
    expect(firstNonNullIndex(points, 'tenkan')).toBe(8);
    expect(itemAt(points, 7).tenkan).toBeNull();
    expect(firstNonNullIndex(points, 'kijun')).toBe(25);
    expect(itemAt(points, 24).kijun).toBeNull();
    expect(firstNonNullIndex(points, 'senkouARaw')).toBe(25);
    expect(itemAt(points, 24).senkouARaw).toBeNull();
    expect(firstNonNullIndex(points, 'projectedSenkouA')).toBe(25);
    expect(firstNonNullIndex(points, 'senkouBRaw')).toBe(51);
    expect(itemAt(points, 50).senkouBRaw).toBeNull();
    expect(firstNonNullIndex(points, 'projectedSenkouB')).toBe(51);
  });

  it('computes line midpoints from inclusive highest-high and lowest-low windows', () => {
    const points = computeIchimoku(trendingCandles(90), baselineConfig);

    expect(itemAt(points, 8).tenkan).toBe(14);
    expect(itemAt(points, 25).tenkan).toBe(31);
    expect(itemAt(points, 25).kijun).toBe(22.5);
    expect(itemAt(points, 25).senkouARaw).toBe(26.75);
    expect(itemAt(points, 51).senkouBRaw).toBe(35.5);
    expect(itemAt(points, 51).projectedSenkouA).toBe(
      itemAt(points, 51).senkouARaw,
    );
    expect(itemAt(points, 51).projectedSenkouB).toBe(
      itemAt(points, 51).senkouBRaw,
    );
  });

  it('uses internal asymmetric high and low extrema rather than closes', () => {
    const candles = [
      candleAt(0, { high: 100, low: 90, close: 95 }),
      candleAt(1, { high: 160, low: 100, close: 110 }),
      candleAt(2, { high: 130, low: 20, close: 100 }),
      candleAt(3, { high: 120, low: 80, close: 100 }),
      candleAt(4, { high: 125, low: 70, close: 100 }),
      candleAt(5, { high: 110, low: 60, close: 100 }),
    ];
    const config: IchimokuConfig = {
      version: 'asymmetric-v1',
      tenkanPeriod: 4,
      kijunPeriod: 5,
      senkouBPeriod: 6,
      displacement: 1,
      kijunSlopeLookback: 1,
    };

    const point = itemAt(computeIchimoku(candles, config), 5);

    expect(point.tenkan).toBe(75);
    expect(point.kijun).toBe(90);
    expect(point.senkouARaw).toBe(82.5);
    expect(point.senkouBRaw).toBe(90);
  });

  it('rejects a canonical price that cannot be represented as a finite number', () => {
    const tooLarge = `1${'0'.repeat(309)}`;
    const candle = candleFromStrings(0, {
      high: tooLarge,
      low: tooLarge,
      close: tooLarge,
    });
    const config: IchimokuConfig = {
      version: 'unit-window-v1',
      tenkanPeriod: 1,
      kijunPeriod: 1,
      senkouBPeriod: 1,
      displacement: 1,
      kijunSlopeLookback: 1,
    };
    let received: unknown;

    try {
      computeIchimoku([candle], config);
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(RangeError);
    expect((received as Error).message).toContain('candle 0 high');
  });

  it('computes a finite overflow-safe midpoint for finite prices near 1e308', () => {
    const low = `1${'0'.repeat(308)}`;
    const high = `11${'0'.repeat(307)}`;
    const candle = candleFromStrings(0, { high, low, close: low });
    const config: IchimokuConfig = {
      version: 'unit-window-v1',
      tenkanPeriod: 1,
      kijunPeriod: 1,
      senkouBPeriod: 1,
      displacement: 1,
      kijunSlopeLookback: 1,
    };
    const point = itemAt(computeIchimoku([candle], config), 0);
    const expected = Number(low) + (Number(high) - Number(low)) / 2;

    expect(point.tenkan).toBe(expected);
    expect(point.kijun).toBe(expected);
    expect(point.senkouARaw).toBe(expected);
    expect(point.senkouBRaw).toBe(expected);
    expect(Number.isFinite(expected)).toBe(true);
  });

  it('never emits a non-finite numeric value for accepted inputs', () => {
    const points = computeIchimoku(trendingCandles(90), baselineConfig);

    for (const point of points) {
      for (const value of Object.values(point)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it('aligns current-cloud values with raw spans computed displacement candles ago', () => {
    const points = computeIchimoku(trendingCandles(90), baselineConfig);

    expect(firstNonNullIndex(points, 'currentCloudA')).toBe(51);
    expect(itemAt(points, 50).currentCloudA).toBeNull();
    expect(itemAt(points, 51).currentCloudA).toBe(
      itemAt(points, 25).senkouARaw,
    );
    expect(itemAt(points, 77).currentCloudA).toBe(
      itemAt(points, 51).senkouARaw,
    );
    expect(itemAt(points, 77).currentCloudA).not.toBe(
      itemAt(points, 77).senkouARaw,
    );

    expect(firstNonNullIndex(points, 'currentCloudB')).toBe(77);
    expect(itemAt(points, 76).currentCloudB).toBeNull();
    expect(itemAt(points, 77).currentCloudB).toBe(
      itemAt(points, 51).senkouBRaw,
    );
    expect(itemAt(points, 77).currentCloudB).not.toBe(
      itemAt(points, 77).senkouBRaw,
    );
  });

  it('only exposes current cloud bounds once both displaced spans exist', () => {
    const points = computeIchimoku(trendingCandles(90), baselineConfig);

    expect(firstNonNullIndex(points, 'currentCloudTop')).toBe(77);
    expect(firstNonNullIndex(points, 'currentCloudBottom')).toBe(77);
    expect(itemAt(points, 76).currentCloudTop).toBeNull();
    expect(itemAt(points, 76).currentCloudBottom).toBeNull();
    expect(itemAt(points, 77).currentCloudTop).toBe(52.75);
    expect(itemAt(points, 77).currentCloudBottom).toBe(35.5);
  });

  it('reports projected bullish, bearish, neutral, and insufficient directions', () => {
    const config: IchimokuConfig = {
      version: 'short-window-v1',
      tenkanPeriod: 2,
      kijunPeriod: 3,
      senkouBPeriod: 4,
      displacement: 1,
      kijunSlopeLookback: 1,
    };
    const bullish = computeIchimoku(trendingCandles(4), config);
    const bearish = computeIchimoku(
      trendingCandles(4, (index) => 20 - index),
      config,
    );
    const neutral = computeIchimoku(
      trendingCandles(4, () => 10),
      config,
    );

    expect(itemAt(bullish, 2).projectedCloudDirection).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(itemAt(bullish, 3).projectedCloudDirection).toBe('BULLISH');
    expect(itemAt(bullish, 3).projectedCloudTop).toBe(
      itemAt(bullish, 3).projectedSenkouA,
    );
    expect(itemAt(bullish, 3).projectedCloudBottom).toBe(
      itemAt(bullish, 3).projectedSenkouB,
    );
    expect(itemAt(bearish, 3).projectedCloudDirection).toBe('BEARISH');
    expect(itemAt(bearish, 3).projectedCloudTop).toBe(
      itemAt(bearish, 3).projectedSenkouB,
    );
    expect(itemAt(bearish, 3).projectedCloudBottom).toBe(
      itemAt(bearish, 3).projectedSenkouA,
    );
    expect(itemAt(neutral, 3).projectedCloudDirection).toBe('NEUTRAL');
    expect(itemAt(neutral, 3).projectedCloudTop).toBe(
      itemAt(neutral, 3).projectedCloudBottom,
    );
  });

  it('uses only an already-observed candle for the chikou reference', () => {
    const candles = trendingCandles(90);
    const points = computeIchimoku(candles, baselineConfig);

    expect(itemAt(points, 25).chikouReferenceIndex).toBeNull();
    expect(itemAt(points, 26)).toMatchObject({
      chikouReferenceIndex: 0,
      chikouReferenceClose: 10,
      chikouReferenceHigh: 11,
      chikouReferenceLow: 9,
    });
    expect(itemAt(points, 77)).toMatchObject({
      chikouReferenceIndex: 51,
      chikouReferenceClose: 61,
      chikouReferenceHigh: 62,
      chikouReferenceLow: 60,
    });
  });

  it('computes the kijun slope against the configured trailing lookback', () => {
    const points = computeIchimoku(trendingCandles(90), baselineConfig);

    expect(firstNonNullIndex(points, 'kijunSlope')).toBe(28);
    expect(itemAt(points, 27).kijunSlope).toBeNull();
    expect(itemAt(points, 28).kijunSlope).toBe(3);
  });

  it('uses each candle availableAt as the decision-relevant computedAt', () => {
    const candles = trendingCandles(90);
    const points = computeIchimoku(candles, baselineConfig);

    expect(itemAt(points, 42).computedAt).toBe(itemAt(candles, 42).availableAt);
  });

  it('does not change an existing output prefix when future candles arrive', () => {
    const allCandles = trendingCandles(100, (index) =>
      index < 90 ? index + 10 : 1_000 - index * 7,
    );
    const prefixPoints = computeIchimoku(
      allCandles.slice(0, 90),
      baselineConfig,
    );
    const appendedPoints = computeIchimoku(allCandles, baselineConfig);

    expect(appendedPoints.slice(0, 90)).toEqual(prefixPoints);
  });

  it('does not mutate its candles and returns immutable output', () => {
    const candles = [...trendingCandles(90)];
    const snapshot: readonly CandleInput[] = candles.map((candle) => ({
      ...candle,
    }));

    const points = computeIchimoku(candles, baselineConfig);

    expect(candles).toEqual(snapshot);
    expect(Object.isFrozen(points)).toBe(true);
    expect(points.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ['tenkanPeriod', 0],
    ['tenkanPeriod', 1.5],
    ['kijunPeriod', -1],
    ['senkouBPeriod', Number.NaN],
    ['displacement', 0],
    ['displacement', Number.POSITIVE_INFINITY],
    ['kijunSlopeLookback', 0],
    ['kijunSlopeLookback', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects invalid %s config values', (field, value) => {
    const invalidConfig = { ...baselineConfig, [field]: value };
    let received: unknown;

    try {
      computeIchimoku([], invalidConfig);
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(RangeError);
    expect((received as Error).message).toContain(field);
  });
});
