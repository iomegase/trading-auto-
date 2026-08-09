import type { Candle, InstantString } from '@trading-auto/domain';

export interface IchimokuConfig {
  readonly tenkanPeriod: number;
  readonly kijunPeriod: number;
  readonly senkouBPeriod: number;
  readonly displacement: number;
  readonly kijunSlopeLookback: number;
}

export type CloudDirection =
  'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INSUFFICIENT_DATA';

export interface IchimokuPoint {
  readonly computedAt: InstantString;
  readonly tenkan: number | null;
  readonly kijun: number | null;
  readonly senkouARaw: number | null;
  readonly senkouBRaw: number | null;
  readonly projectedSenkouA: number | null;
  readonly projectedSenkouB: number | null;
  readonly currentCloudA: number | null;
  readonly currentCloudB: number | null;
  readonly currentCloudTop: number | null;
  readonly currentCloudBottom: number | null;
  readonly projectedCloudTop: number | null;
  readonly projectedCloudBottom: number | null;
  readonly projectedCloudDirection: CloudDirection;
  readonly chikouReferenceIndex: number | null;
  readonly chikouReferenceClose: number | null;
  readonly chikouReferenceHigh: number | null;
  readonly chikouReferenceLow: number | null;
  readonly kijunSlope: number | null;
}

const configFields = [
  'tenkanPeriod',
  'kijunPeriod',
  'senkouBPeriod',
  'displacement',
  'kijunSlopeLookback',
] as const satisfies readonly (keyof IchimokuConfig)[];

function validateConfig(config: Readonly<IchimokuConfig>): void {
  for (const field of configFields) {
    const value = config[field];

    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${field} must be a positive safe integer.`);
    }
  }
}

interface NumericCandle {
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

function finitePrice(
  candle: Readonly<Candle>,
  index: number,
  field: 'high' | 'low' | 'close',
): number {
  const value = Number(candle[field]);

  if (!Number.isFinite(value)) {
    throw new RangeError(
      `candle ${String(index)} ${field} must be representable as a finite number.`,
    );
  }

  return value;
}

function numericCandle(candle: Readonly<Candle>, index: number): NumericCandle {
  return Object.freeze({
    high: finitePrice(candle, index, 'high'),
    low: finitePrice(candle, index, 'low'),
    close: finitePrice(candle, index, 'close'),
  });
}

function finiteMidpoint(first: number, second: number): number {
  const lower = Math.min(first, second);
  const upper = Math.max(first, second);
  const midpoint = lower + (upper - lower) / 2;

  if (!Number.isFinite(midpoint)) {
    throw new RangeError('Ichimoku midpoint must be finite.');
  }

  return midpoint;
}

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new RangeError(`Expected an item at index ${String(index)}.`);
  }

  return item;
}

function midpointAt(
  candles: readonly NumericCandle[],
  index: number,
  period: number,
): number | null {
  const start = index - period + 1;

  if (start < 0) {
    return null;
  }

  let highestHigh = Number.NEGATIVE_INFINITY;
  let lowestLow = Number.POSITIVE_INFINITY;

  for (let windowIndex = start; windowIndex <= index; windowIndex += 1) {
    const candle = itemAt(candles, windowIndex);
    highestHigh = Math.max(highestHigh, candle.high);
    lowestLow = Math.min(lowestLow, candle.low);
  }

  return finiteMidpoint(highestHigh, lowestLow);
}

function cloudDirection(
  senkouA: number | null,
  senkouB: number | null,
): CloudDirection {
  if (senkouA === null || senkouB === null) {
    return 'INSUFFICIENT_DATA';
  }

  if (senkouA > senkouB) {
    return 'BULLISH';
  }

  if (senkouA < senkouB) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}

function cloudTop(
  senkouA: number | null,
  senkouB: number | null,
): number | null {
  return senkouA === null || senkouB === null
    ? null
    : Math.max(senkouA, senkouB);
}

function cloudBottom(
  senkouA: number | null,
  senkouB: number | null,
): number | null {
  return senkouA === null || senkouB === null
    ? null
    : Math.min(senkouA, senkouB);
}

export function computeIchimoku(
  candles: readonly Candle[],
  config: Readonly<IchimokuConfig>,
): readonly IchimokuPoint[] {
  validateConfig(config);

  const numericCandles = candles.map(numericCandle);

  const tenkan = numericCandles.map((_, index) =>
    midpointAt(numericCandles, index, config.tenkanPeriod),
  );
  const kijun = numericCandles.map((_, index) =>
    midpointAt(numericCandles, index, config.kijunPeriod),
  );
  const senkouBRaw = numericCandles.map((_, index) =>
    midpointAt(numericCandles, index, config.senkouBPeriod),
  );
  const senkouARaw = candles.map((_, index) => {
    const tenkanValue = itemAt(tenkan, index);
    const kijunValue = itemAt(kijun, index);

    return tenkanValue === null || kijunValue === null
      ? null
      : finiteMidpoint(tenkanValue, kijunValue);
  });

  const points = candles.map((candle, index): Readonly<IchimokuPoint> => {
    const rawA = itemAt(senkouARaw, index);
    const rawB = itemAt(senkouBRaw, index);
    const displacedIndex = index - config.displacement;
    const currentA =
      displacedIndex < 0 ? null : itemAt(senkouARaw, displacedIndex);
    const currentB =
      displacedIndex < 0 ? null : itemAt(senkouBRaw, displacedIndex);
    const chikouCandle =
      displacedIndex < 0 ? null : itemAt(numericCandles, displacedIndex);
    const slopeReferenceIndex = index - config.kijunSlopeLookback;
    const currentKijun = itemAt(kijun, index);
    const referenceKijun =
      slopeReferenceIndex < 0 ? null : itemAt(kijun, slopeReferenceIndex);

    return Object.freeze({
      computedAt: candle.availableAt,
      tenkan: itemAt(tenkan, index),
      kijun: currentKijun,
      senkouARaw: rawA,
      senkouBRaw: rawB,
      projectedSenkouA: rawA,
      projectedSenkouB: rawB,
      currentCloudA: currentA,
      currentCloudB: currentB,
      currentCloudTop: cloudTop(currentA, currentB),
      currentCloudBottom: cloudBottom(currentA, currentB),
      projectedCloudTop: cloudTop(rawA, rawB),
      projectedCloudBottom: cloudBottom(rawA, rawB),
      projectedCloudDirection: cloudDirection(rawA, rawB),
      chikouReferenceIndex: chikouCandle === null ? null : displacedIndex,
      chikouReferenceClose: chikouCandle === null ? null : chikouCandle.close,
      chikouReferenceHigh: chikouCandle === null ? null : chikouCandle.high,
      chikouReferenceLow: chikouCandle === null ? null : chikouCandle.low,
      kijunSlope:
        currentKijun === null || referenceKijun === null
          ? null
          : currentKijun - referenceKijun,
    });
  });

  return Object.freeze(points);
}
