import { Temporal } from '@js-temporal/polyfill';

import { createCandle, type Candle, type CandleInput } from './candle.js';
import type { Timeframe } from './time.js';

export interface CandleSeriesExpectation {
  readonly instrumentId?: string;
  readonly timeframe?: Timeframe;
}

function invalidSeries(index: number, invariant: string): never {
  throw new RangeError(
    `Candle series index ${String(index)} violates ${invariant}.`,
  );
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function candleAt(
  candles: readonly unknown[],
  index: number,
): Readonly<Candle> {
  if (!Object.hasOwn(candles, index)) {
    invalidSeries(index, 'the dense array invariant');
  }

  const candidate = candles[index];

  try {
    createCandle(candidate as CandleInput);
  } catch {
    invalidSeries(index, 'the valid Candle invariant');
  }

  return candidate as Readonly<Candle>;
}

export function assertCandleSeries(
  candles: unknown,
  expectation: CandleSeriesExpectation = {},
): asserts candles is readonly Readonly<Candle>[] {
  if (!isArray(candles)) {
    throw new RangeError('Candle series must be a dense array.');
  }

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candleAt(candles, index);
    const first = candleAt(candles, 0);

    if (
      expectation.instrumentId !== undefined &&
      candle.instrumentId !== expectation.instrumentId
    ) {
      invalidSeries(index, 'the expected instrumentId invariant');
    }

    if (
      expectation.timeframe !== undefined &&
      candle.timeframe !== expectation.timeframe
    ) {
      invalidSeries(index, 'the expected timeframe invariant');
    }

    if (index === 0) {
      continue;
    }

    const previous = candleAt(candles, index - 1);

    if (candle.instrumentId !== first.instrumentId) {
      invalidSeries(index, 'the homogeneous instrumentId invariant');
    }

    if (candle.timeframe !== first.timeframe) {
      invalidSeries(index, 'the homogeneous timeframe invariant');
    }

    if (Temporal.Instant.compare(candle.closeTime, previous.closeTime) <= 0) {
      invalidSeries(index, 'the strictly increasing closeTime invariant');
    }

    if (Temporal.Instant.compare(candle.openTime, previous.closeTime) < 0) {
      invalidSeries(
        index,
        'the openTime must not precede the previous closeTime invariant',
      );
    }
  }
}
