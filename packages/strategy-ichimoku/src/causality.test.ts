import { selectLatestAvailableClosedCandle } from '@trading-auto/calendars';
import { asDecimalString, type Candle } from '@trading-auto/domain';
import { computeIchimoku, type IchimokuConfig } from '@trading-auto/indicators';
import { buildCandle } from '@trading-auto/test-helpers';
import { describe, expect, it } from 'vitest';

import {
  detectBreakout,
  evaluateH1Candidate,
  evaluateH4Regime,
  proposeKijunStop,
} from './index.js';

const config: IchimokuConfig = {
  version: 'causality-v1',
  tenkanPeriod: 9,
  kijunPeriod: 26,
  senkouBPeriod: 52,
  displacement: 26,
  kijunSlopeLookback: 3,
};

function instantAt(hour: number): string {
  return new Date(Date.UTC(2026, 0, 1, hour)).toISOString();
}

function series(
  length: number,
  futureShockAt: number,
  timeframe: '1h' | '4h' = '1h',
  startHour = 0,
  durationHours = 1,
): readonly Candle[] {
  return Array.from({ length }, (_, index) => {
    const baseline =
      index < futureShockAt ? 100 + index * 2 : 10_000 - index * 50;
    const close = String(baseline);

    return buildCandle({
      timeframe,
      sourceTimestamp: instantAt(startHour + index * durationHours),
      openTime: instantAt(startHour + index * durationHours),
      closeTime: instantAt(startHour + (index + 1) * durationHours),
      availableAt: instantAt(startHour + (index + 1) * durationHours),
      ingestedAt: instantAt(startHour + (index + 1) * durationHours),
      open: close,
      high: String(baseline + 1),
      low: String(baseline - 1),
      close,
    });
  });
}

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new RangeError(`Expected an item at index ${String(index)}.`);
  }

  return item;
}

function runPipeline(
  h1Candles: readonly Candle[],
  trendCandles: readonly Candle[],
  decisionIndex: number,
) {
  const decisionCandle = itemAt(h1Candles, decisionIndex);
  const decisionAt = decisionCandle.availableAt;
  const trendCandle = selectLatestAvailableClosedCandle(
    trendCandles,
    decisionAt,
  );

  if (trendCandle === null) {
    throw new RangeError('Expected an available trend candle.');
  }

  const signalIndicator = itemAt(
    computeIchimoku(h1Candles, config),
    decisionIndex,
  );
  const trendIndex = trendCandles.indexOf(trendCandle);
  const trendIndicator = itemAt(
    computeIchimoku(trendCandles, config),
    trendIndex,
  );
  const breakout = detectBreakout(h1Candles, decisionIndex, 20);
  const regime = evaluateH4Regime(trendCandle, trendIndicator);
  const candidate = evaluateH1Candidate({
    direction: 'LONG',
    regime,
    candles: h1Candles,
    index: decisionIndex,
    indicator: signalIndicator,
    breakoutLookback: 20,
    decisionAt,
    trendCandleCloseTime: trendCandle.closeTime,
    strategyVersion: 'ichimoku-v1',
    datasetVersion: 'dataset-v1',
  });
  const stop = proposeKijunStop(
    'LONG',
    signalIndicator.kijunPrice,
    decisionCandle.close,
    asDecimalString('1'),
  );

  return {
    signalIndicator,
    trendCandle,
    trendIndicator,
    breakout,
    regime,
    candidate,
    stop,
  };
}

describe('full strategy causality', () => {
  it('keeps every decision-time result unchanged when future candles are appended', () => {
    const decisionIndex = 90;
    const h1WithFuture = series(120, decisionIndex + 1);
    const trendWithFuture = series(120, 112, '4h', -360, 4);
    const h1AtDecision = h1WithFuture.slice(0, decisionIndex + 1);
    const trendAtDecision = trendWithFuture.slice(0, 112);

    const prefixResult = runPipeline(
      h1AtDecision,
      trendAtDecision,
      decisionIndex,
    );
    const futureResult = runPipeline(
      h1WithFuture,
      trendWithFuture,
      decisionIndex,
    );

    expect(prefixResult).toEqual(futureResult);
    expect(prefixResult.candidate.status).toBe('APPROVED');
    expect(prefixResult.stop.status).toBe('VALID');
  });
});
