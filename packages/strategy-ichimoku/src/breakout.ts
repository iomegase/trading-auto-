import { assertCandleSeries, type Candle } from '@trading-auto/domain';

import { StrategyDecimal } from './decimal.js';

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
  assertCandleSeries(candles);

  if (!Number.isSafeInteger(index) || index < 0 || index >= candles.length) {
    throw new RangeError(
      'index must be a safe integer within the candle array.',
    );
  }

  if (!Number.isSafeInteger(lookback) || lookback <= 0) {
    throw new RangeError('lookback must be a positive safe integer.');
  }

  const currentCandle = candleAt(candles, index);

  if (index < lookback) {
    return { status: 'INSUFFICIENT_DATA' };
  }

  const start = index - lookback;
  const firstPriorCandle = candleAt(candles, start);
  let highestHigh = new StrategyDecimal(firstPriorCandle.high);
  let lowestLow = new StrategyDecimal(firstPriorCandle.low);

  for (let windowIndex = start + 1; windowIndex < index; windowIndex += 1) {
    const priorCandle = candleAt(candles, windowIndex);
    highestHigh = StrategyDecimal.max(highestHigh, priorCandle.high);
    lowestLow = StrategyDecimal.min(lowestLow, priorCandle.low);
  }

  const close = new StrategyDecimal(currentCandle.close);

  if (close.gt(highestHigh)) {
    return { status: 'LONG' };
  }

  if (close.lt(lowestLow)) {
    return { status: 'SHORT' };
  }

  return { status: 'NONE' };
}
