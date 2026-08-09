import type { Candle, CandleInput } from '@trading-auto/domain';
import { buildCandle } from '@trading-auto/test-helpers';
import { describe, expect, it } from 'vitest';

import {
  computeIchimoku,
  type IchimokuConfig,
  type IchimokuPoint,
} from './index.js';

const baselineConfig: IchimokuConfig = {
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
