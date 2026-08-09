import type { Candle } from '@trading-auto/domain';
import { Decimal } from 'decimal.js';

export type BreakoutResult =
  | { readonly status: 'LONG' | 'SHORT' | 'NONE' }
  | { readonly status: 'INSUFFICIENT_DATA' };

function candleAt(candles: readonly Candle[], index: number): Candle {
  const candle = candles[index];

  if (candle === undefined) {
    throw new RangeError(`Expected a candle at index ${String(index)}.`);
  }

  return candle;
}

export function detectBreakout(
  candles: readonly Candle[],
  index: number,
  lookback: number,
): BreakoutResult {
  if (!Number.isSafeInteger(index) || index < 0 || index >= candles.length) {
    throw new RangeError(
      'index must be a safe integer within the candle array.',
    );
  }

  if (!Number.isSafeInteger(lookback) || lookback <= 0) {
    throw new RangeError('lookback must be a positive safe integer.');
  }

  if (index < lookback) {
    return { status: 'INSUFFICIENT_DATA' };
  }

  const start = index - lookback;
  const firstPriorCandle = candleAt(candles, start);
  let highestHigh = new Decimal(firstPriorCandle.high);
  let lowestLow = new Decimal(firstPriorCandle.low);

  for (let windowIndex = start + 1; windowIndex < index; windowIndex += 1) {
    const priorCandle = candleAt(candles, windowIndex);
    highestHigh = Decimal.max(highestHigh, priorCandle.high);
    lowestLow = Decimal.min(lowestLow, priorCandle.low);
  }

  const close = new Decimal(candleAt(candles, index).close);

  if (close.gt(highestHigh)) {
    return { status: 'LONG' };
  }

  if (close.lt(lowestLow)) {
    return { status: 'SHORT' };
  }

  return { status: 'NONE' };
}
