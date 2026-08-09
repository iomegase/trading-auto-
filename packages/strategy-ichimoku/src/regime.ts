import { Temporal } from '@js-temporal/polyfill';
import type { Candle } from '@trading-auto/domain';
import type { CloudDirection, IchimokuPoint } from '@trading-auto/indicators';

import { StrategyDecimal } from './decimal.js';

export type MarketRegime =
  'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INSUFFICIENT_DATA';

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be finite.`);
  }
}

function assertProjectedCloudDirection(
  value: unknown,
): asserts value is CloudDirection {
  if (
    value !== 'BULLISH' &&
    value !== 'BEARISH' &&
    value !== 'NEUTRAL' &&
    value !== 'INSUFFICIENT_DATA'
  ) {
    throw new RangeError(
      'projectedCloudDirection must be BULLISH, BEARISH, NEUTRAL, or INSUFFICIENT_DATA.',
    );
  }
}

function assertProvenance(candle: Candle, point: IchimokuPoint): void {
  if (candle.timeframe !== '4h') {
    throw new RangeError('H4 regime requires a 4h candle timeframe.');
  }

  if (point.instrumentId !== candle.instrumentId) {
    throw new RangeError('Ichimoku point instrumentId must match the candle.');
  }

  if (point.timeframe !== candle.timeframe) {
    throw new RangeError('Ichimoku point timeframe must match the candle.');
  }

  if (Temporal.Instant.compare(point.candleCloseTime, candle.closeTime) !== 0) {
    throw new RangeError(
      'Ichimoku point candleCloseTime must match the candle closeTime.',
    );
  }
}

export function evaluateH4Regime(
  candle: Candle,
  point: IchimokuPoint,
): MarketRegime {
  assertProjectedCloudDirection(point.projectedCloudDirection);
  assertProvenance(candle, point);

  const { currentCloudTop, currentCloudBottom, kijunSlope } = point;

  if (currentCloudTop !== null) {
    assertFinite(currentCloudTop, 'currentCloudTop');
  }

  if (currentCloudBottom !== null) {
    assertFinite(currentCloudBottom, 'currentCloudBottom');
  }

  if (kijunSlope !== null) {
    assertFinite(kijunSlope, 'kijunSlope');
  }

  if (
    currentCloudTop === null ||
    currentCloudBottom === null ||
    kijunSlope === null ||
    point.projectedCloudDirection === 'INSUFFICIENT_DATA'
  ) {
    return 'INSUFFICIENT_DATA';
  }

  const close = new StrategyDecimal(candle.close);

  if (
    close.gt(new StrategyDecimal(currentCloudTop)) &&
    kijunSlope > 0 &&
    point.projectedCloudDirection === 'BULLISH'
  ) {
    return 'BULLISH';
  }

  if (
    close.lt(new StrategyDecimal(currentCloudBottom)) &&
    kijunSlope < 0 &&
    point.projectedCloudDirection === 'BEARISH'
  ) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}
