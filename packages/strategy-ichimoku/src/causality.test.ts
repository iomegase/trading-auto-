import { Temporal } from '@js-temporal/polyfill';
import { asDecimalString, type Candle } from '@trading-auto/domain';
import type { IchimokuConfig } from '@trading-auto/indicators';
import { buildCandle } from '@trading-auto/test-helpers';
import { describe, expect, it } from 'vitest';

import { evaluateIchimokuDecision } from './index.js';

const config: IchimokuConfig = {
  version: 'causality-9-26-52-v1',
  tenkanPeriod: 9,
  kijunPeriod: 26,
  senkouBPeriod: 52,
  displacement: 26,
  kijunSlopeLookback: 3,
};

const h1DecisionIndex = 110;
const h4CurrentWindowIndex = 95;

function instantAt(hour: number): string {
  return new Date(Date.UTC(2026, 0, 1, hour)).toISOString();
}

function series(
  timeframe: '1h' | '4h',
  length: number,
  startHour: number,
  durationHours: number,
  futureShockAt: number,
  unfinishedIndex: number | null = null,
  lateAvailableIndex: number | null = null,
): readonly Candle[] {
  return Array.from({ length }, (_, index) => {
    const baseline = 100 + index * 2;
    const isFutureShock = index >= futureShockAt;
    const close = isFutureShock ? `1${'0'.repeat(400)}` : String(baseline);
    const openTime = instantAt(startHour + index * durationHours);
    const closeTime = instantAt(startHour + (index + 1) * durationHours);
    const availableAt =
      index === lateAvailableIndex
        ? instantAt(startHour + (index + 2) * durationHours)
        : closeTime;

    return buildCandle({
      timeframe,
      sourceTimestamp: openTime,
      openTime,
      closeTime,
      availableAt,
      ingestedAt: availableAt,
      open: close,
      high: isFutureShock ? close : String(baseline + 1),
      low: isFutureShock ? close : String(baseline - 1),
      close,
      isClosed: index !== unfinishedIndex,
    });
  });
}

describe('full strategy causality', () => {
  it('keeps the entire decision unchanged when large H1 and H4 future shocks are appended', () => {
    const h1WithFuture = series('1h', 140, 0, 1, h1DecisionIndex + 1);
    const h4WithFuture = series(
      '4h',
      110,
      -272,
      4,
      h4CurrentWindowIndex + 1,
      h4CurrentWindowIndex,
      h4CurrentWindowIndex - 1,
    );
    const h1AtDecision = h1WithFuture.slice(0, h1DecisionIndex + 1);
    const h4AtDecision = h4WithFuture.slice(0, h4CurrentWindowIndex + 1);
    const signalCandle = h1AtDecision[h1DecisionIndex];

    if (signalCandle === undefined) {
      throw new RangeError('Expected the H1 decision candle.');
    }

    const input = {
      direction: 'LONG' as const,
      signalIndex: h1DecisionIndex,
      indicatorConfig: config,
      breakoutLookback: 20,
      decisionAt: signalCandle.availableAt,
      datasetVersion: 'causality-dataset-v1',
      strategyVersion: 'ichimoku-v1',
      entryReference: signalCandle.close,
      tickSize: asDecimalString('1'),
    };
    const prefixResult = evaluateIchimokuDecision({
      ...input,
      h1Candles: h1AtDecision,
      h4Candles: h4AtDecision,
    });
    const futureResult = evaluateIchimokuDecision({
      ...input,
      h1Candles: h1WithFuture,
      h4Candles: h4WithFuture,
    });

    expect(prefixResult).toEqual(futureResult);
    expect(prefixResult.status).toBe('APPROVED');

    if (prefixResult.status === 'UNAVAILABLE') {
      throw new RangeError('Expected an evaluated causal decision.');
    }

    expect(
      Temporal.Instant.compare(
        prefixResult.trendCandleCloseTime,
        prefixResult.decisionAt,
      ),
    ).toBeLessThan(0);
    expect(prefixResult.trendCandleCloseTime).toBe('2026-01-05T08:00:00Z');
  });
});
