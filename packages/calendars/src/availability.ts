import { Temporal } from '@js-temporal/polyfill';
import type { Candle, InstantString } from '@trading-auto/domain';

export function selectLatestAvailableClosedCandle(
  candles: readonly Candle[],
  decisionAt: InstantString,
): Candle | null {
  let latest: Candle | null = null;

  for (const candle of candles) {
    if (
      !candle.isClosed ||
      Temporal.Instant.compare(candle.availableAt, decisionAt) > 0
    ) {
      continue;
    }

    if (
      latest === null ||
      Temporal.Instant.compare(candle.closeTime, latest.closeTime) > 0
    ) {
      latest = candle;
    }
  }

  return latest;
}
