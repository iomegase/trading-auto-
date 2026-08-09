import { Temporal } from '@js-temporal/polyfill';
import {
  asInstantString,
  createCandle,
  type Candle,
  type CandleInput,
  type InstantString,
} from '@trading-auto/domain';

function candleAt(candles: readonly Candle[], index: number): Candle {
  if (!Object.hasOwn(candles, index)) {
    throw new RangeError(`Candle list is sparse at index ${String(index)}.`);
  }

  const candle = candles[index];

  try {
    createCandle(candle as CandleInput);
  } catch {
    throw new RangeError(
      `Candle list contains an invalid candle at index ${String(index)}.`,
    );
  }

  return candle as Candle;
}

export function selectLatestAvailableClosedCandle(
  candles: readonly Candle[],
  decisionAt: InstantString,
): Candle | null {
  if (!Array.isArray(candles)) {
    throw new RangeError('Candle list must be a dense array.');
  }

  const normalizedDecisionAt = asInstantString(decisionAt);
  let latest: Candle | null = null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candleAt(candles, index);

    if (
      !candle.isClosed ||
      Temporal.Instant.compare(candle.availableAt, normalizedDecisionAt) > 0
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
