import type { Candle } from '@trading-auto/domain';
import type { IchimokuPoint } from '@trading-auto/indicators';
import { Decimal } from 'decimal.js';

export type MarketRegime =
  'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INSUFFICIENT_DATA';

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be finite.`);
  }
}

export function evaluateH4Regime(
  candle: Candle,
  point: IchimokuPoint,
): MarketRegime {
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

  const close = new Decimal(candle.close);

  if (
    close.gt(new Decimal(currentCloudTop)) &&
    kijunSlope > 0 &&
    point.projectedCloudDirection === 'BULLISH'
  ) {
    return 'BULLISH';
  }

  if (
    close.lt(new Decimal(currentCloudBottom)) &&
    kijunSlope < 0 &&
    point.projectedCloudDirection === 'BEARISH'
  ) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}
