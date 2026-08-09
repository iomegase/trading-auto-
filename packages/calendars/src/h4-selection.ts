import { Temporal } from '@js-temporal/polyfill';
import {
  asInstantString,
  assertCandleSeries,
  type Candle,
  type InstantString,
} from '@trading-auto/domain';
import type { IchimokuPoint } from '@trading-auto/indicators';

export type H4SelectionResult =
  | {
      readonly status: 'SELECTED';
      readonly candle: Candle;
      readonly point: IchimokuPoint;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly reason: 'NO_CLOSED_TREND_CANDLE' | 'INSUFFICIENT_DATA';
    };

function invalidSelection(message: string): never {
  throw new RangeError(`Invalid H4 selection input: ${message}.`);
}

function pointAt(
  points: readonly IchimokuPoint[],
  index: number,
): IchimokuPoint {
  if (!Object.hasOwn(points, index)) {
    invalidSelection(`snapshot array is sparse at index ${String(index)}`);
  }

  const point: unknown = points[index];

  if (typeof point !== 'object' || point === null || Array.isArray(point)) {
    invalidSelection(`snapshot at index ${String(index)} is not an object`);
  }

  return point as IchimokuPoint;
}

function candleAt(candles: readonly Candle[], index: number): Candle {
  const candle = candles[index];

  if (candle === undefined) {
    invalidSelection(`candle array is sparse at index ${String(index)}`);
  }

  return candle;
}

function assertPointMatchesCandle(
  point: IchimokuPoint,
  candle: Candle,
  index: number,
): void {
  if (point.instrumentId !== candle.instrumentId) {
    invalidSelection(`snapshot instrument mismatch at index ${String(index)}`);
  }

  if (point.timeframe !== candle.timeframe || point.timeframe !== '4h') {
    invalidSelection(`snapshot timeframe mismatch at index ${String(index)}`);
  }

  if (Temporal.Instant.compare(point.candleCloseTime, candle.closeTime) !== 0) {
    invalidSelection(`snapshot close mismatch at index ${String(index)}`);
  }

  asInstantString(point.computedAt);
}

function hasCompleteRegimeData(point: IchimokuPoint): boolean {
  return (
    point.currentCloudTop !== null &&
    point.currentCloudBottom !== null &&
    point.kijunSlope !== null &&
    point.projectedCloudDirection !== 'INSUFFICIENT_DATA'
  );
}

export function selectLatestAvailableH4Snapshot(
  candles: readonly Candle[],
  points: readonly IchimokuPoint[],
  decisionAt: InstantString,
  instrumentId: string,
): Readonly<H4SelectionResult> {
  if (typeof instrumentId !== 'string' || instrumentId.trim().length === 0) {
    invalidSelection('instrumentId must be a non-blank string');
  }

  const normalizedDecisionAt = asInstantString(decisionAt);
  assertCandleSeries(candles, { instrumentId, timeframe: '4h' });

  if (!Array.isArray(points) || points.length !== candles.length) {
    invalidSelection('candle and snapshot arrays must have equal lengths');
  }

  let latestIndex: number | null = null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candleAt(candles, index);

    const point = pointAt(points, index);
    assertPointMatchesCandle(point, candle, index);

    if (
      !candle.isClosed ||
      Temporal.Instant.compare(candle.availableAt, normalizedDecisionAt) > 0
    ) {
      continue;
    }

    if (
      latestIndex === null ||
      Temporal.Instant.compare(
        candle.closeTime,
        candleAt(candles, latestIndex).closeTime,
      ) > 0
    ) {
      latestIndex = index;
    }
  }

  if (latestIndex === null) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'NO_CLOSED_TREND_CANDLE',
    });
  }

  const candle = candleAt(candles, latestIndex);
  const point = pointAt(points, latestIndex);

  if (
    Temporal.Instant.compare(point.computedAt, normalizedDecisionAt) > 0 ||
    !hasCompleteRegimeData(point)
  ) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_DATA',
    });
  }

  return Object.freeze({ status: 'SELECTED', candle, point });
}
