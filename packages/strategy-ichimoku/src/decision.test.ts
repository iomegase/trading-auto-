import {
  asDecimalString,
  asInstantString,
  type Candle,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import type { IchimokuConfig } from '@trading-auto/indicators';
import { buildCandle } from '@trading-auto/test-helpers';
import { describe, expect, it } from 'vitest';

import * as publicApi from './index.js';
import {
  evaluateIchimokuDecision,
  type IchimokuDecisionInput,
} from './index.js';

const indicatorConfig: IchimokuConfig = {
  version: 'decision-config-v1',
  tenkanPeriod: 1,
  kijunPeriod: 2,
  senkouBPeriod: 3,
  displacement: 1,
  kijunSlopeLookback: 1,
};

function instantAt(hour: number): string {
  return new Date(Date.UTC(2026, 0, 2, hour)).toISOString();
}

function genuineSeries(
  timeframe: '1h' | '4h',
  length: number,
  startHour: number,
  durationHours: number,
  breakoutIndex: number,
  direction: 'LONG' | 'SHORT' = 'LONG',
): readonly Candle[] {
  return Array.from({ length }, (_, index) => {
    const close =
      index === breakoutIndex
        ? direction === 'LONG'
          ? '20'
          : '10'
        : direction === 'LONG'
          ? '10'
          : '20';
    const openTime = instantAt(startHour + index * durationHours);
    const closeTime = instantAt(startHour + (index + 1) * durationHours);

    return buildCandle({
      timeframe,
      sourceTimestamp: openTime,
      openTime,
      closeTime,
      availableAt: closeTime,
      ingestedAt: closeTime,
      open: close,
      high: close,
      low: close,
      close,
      isClosed: !(timeframe === '4h' && index === breakoutIndex + 1),
    });
  });
}

function h1Series(): readonly Candle[] {
  return genuineSeries('1h', 7, 0, 1, 6);
}

function h4Series(): readonly Candle[] {
  return genuineSeries('4h', 6, -16, 4, 4);
}

function shortH1Series(): readonly Candle[] {
  return genuineSeries('1h', 7, 0, 1, 6, 'SHORT');
}

function shortH4Series(): readonly Candle[] {
  return genuineSeries('4h', 6, -16, 4, 4, 'SHORT');
}

function validInput(
  overrides: Partial<IchimokuDecisionInput> = {},
): IchimokuDecisionInput {
  return {
    direction: 'LONG',
    h1Candles: h1Series(),
    h4Candles: h4Series(),
    signalIndex: 6,
    indicatorConfig,
    breakoutLookback: 2,
    decisionAt: asInstantString('2026-01-02T07:00:00Z'),
    datasetVersion: 'dataset-v1',
    strategyVersion: 'strategy-v1',
    entryReference: asDecimalString('20'),
    tickSize: asDecimalString('1'),
    ...overrides,
  };
}

describe('evaluateIchimokuDecision', () => {
  it('approves only through a selected causal H4 snapshot and exact stop', () => {
    const result = evaluateIchimokuDecision(validInput());

    expect(result).toEqual({
      status: 'APPROVED',
      direction: 'LONG',
      regime: 'BULLISH',
      decisionAt: '2026-01-02T07:00:00Z',
      signalCandleCloseTime: '2026-01-02T07:00:00Z',
      trendCandleCloseTime: '2026-01-02T04:00:00Z',
      datasetVersion: 'dataset-v1',
      strategyVersion: 'strategy-v1',
      indicatorConfigVersion: 'decision-config-v1',
      reasons: [],
      stop: { status: 'VALID', price: '15' },
    });
    expect(Object.isFrozen(result)).toBe(true);

    if (result.status === 'UNAVAILABLE') {
      throw new RangeError('Expected an evaluated decision.');
    }

    expect(Object.isFrozen(result.reasons)).toBe(true);
    expect(Object.isFrozen(result.stop)).toBe(true);
  });

  it('propagates NO_CLOSED_TREND_CANDLE without producing an approval', () => {
    const h4Candles = h4Series().map((candle) =>
      buildCandle({ ...candle, isClosed: false }),
    );

    expect(evaluateIchimokuDecision(validInput({ h4Candles }))).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NO_CLOSED_TREND_CANDLE',
      direction: 'LONG',
      decisionAt: '2026-01-02T07:00:00Z',
      signalCandleCloseTime: '2026-01-02T07:00:00Z',
      datasetVersion: 'dataset-v1',
      strategyVersion: 'strategy-v1',
      indicatorConfigVersion: 'decision-config-v1',
    });
  });

  it('canonicalizes the unavailable signal close time from runtime input', () => {
    const input = validInput({ h4Candles: [] });
    const h1Candles = [...input.h1Candles];
    const signal = h1Candles[input.signalIndex];

    if (signal === undefined) {
      throw new RangeError('Expected the signal fixture.');
    }

    h1Candles[input.signalIndex] = {
      ...signal,
      closeTime: '2026-01-02T08:00:00+01:00' as InstantString,
    };

    expect(evaluateIchimokuDecision({ ...input, h1Candles })).toMatchObject({
      status: 'UNAVAILABLE',
      signalCandleCloseTime: '2026-01-02T07:00:00Z',
    });
  });

  it('approves a complete SHORT decision through the same causal boundary', () => {
    expect(
      evaluateIchimokuDecision(
        validInput({
          direction: 'SHORT',
          h1Candles: shortH1Series(),
          h4Candles: shortH4Series(),
          entryReference: asDecimalString('10'),
        }),
      ),
    ).toMatchObject({
      status: 'APPROVED',
      direction: 'SHORT',
      regime: 'BEARISH',
      reasons: [],
      stop: { status: 'VALID', price: '15' },
    });
  });

  it('propagates INSUFFICIENT_DATA from the selected H4 boundary', () => {
    expect(
      evaluateIchimokuDecision(
        validInput({ h4Candles: h4Series().slice(0, 1) }),
      ),
    ).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('does not convert a closed H4 candle published after decision time', () => {
    const decisionAt = asInstantString('2026-01-02T09:00:00Z');
    const baselineInput = validInput({ decisionAt });
    const baseline = evaluateIchimokuDecision(baselineInput);
    const h4Candles = [...baselineInput.h4Candles];
    const late = h4Candles[5];

    if (late === undefined) {
      throw new RangeError('Expected the late H4 fixture.');
    }

    const hugePrice = `1${'0'.repeat(400)}`;
    h4Candles[5] = buildCandle({
      ...late,
      availableAt: '2026-01-02T10:00:00Z',
      ingestedAt: '2026-01-02T10:00:00Z',
      open: hugePrice,
      high: hugePrice,
      low: hugePrice,
      close: hugePrice,
      isClosed: true,
    });

    expect(evaluateIchimokuDecision({ ...baselineInput, h4Candles })).toEqual(
      baseline,
    );
    expect(baseline.status).toBe('APPROVED');
  });

  it('rejects a candidate that would otherwise approve when its stop is invalid', () => {
    const result = evaluateIchimokuDecision(
      validInput({ entryReference: asDecimalString('15') }),
    );

    expect(result).toMatchObject({
      status: 'REJECTED',
      regime: 'BULLISH',
      reasons: ['INVALID_INITIAL_STOP'],
      stop: { status: 'INVALID_INITIAL_STOP' },
    });
  });

  it('preserves every reproducibility version on a rejected result', () => {
    const result = evaluateIchimokuDecision(
      validInput({
        breakoutLookback: 20,
        datasetVersion: 'dataset-v2',
        strategyVersion: 'strategy-v2',
        indicatorConfig: { ...indicatorConfig, version: 'config-v2' },
      }),
    );

    expect(result).toMatchObject({
      status: 'REJECTED',
      datasetVersion: 'dataset-v2',
      strategyVersion: 'strategy-v2',
      indicatorConfigVersion: 'config-v2',
      reasons: ['INSUFFICIENT_DATA'],
    });
  });

  it.each([
    ['datasetVersion', ''],
    ['datasetVersion', '   '],
    ['strategyVersion', ''],
    ['strategyVersion', '   '],
  ] as const)(
    'rejects blank %s before an unavailable result',
    (field, value) => {
      expect(() =>
        evaluateIchimokuDecision(
          validInput({
            h4Candles: [],
            [field]: value,
          }),
        ),
      ).toThrow(new RegExp(field));
    },
  );

  it('does not publicly export the raw candidate approval function', () => {
    expect(publicApi).not.toHaveProperty('evaluateH1Candidate');
  });

  it('rejects an invalid runtime direction and signal index', () => {
    expect(() =>
      evaluateIchimokuDecision({
        ...validInput(),
        direction: 'SIDEWAYS' as unknown as 'LONG',
      }),
    ).toThrow(/direction/);
    expect(() =>
      evaluateIchimokuDecision(validInput({ signalIndex: 7 })),
    ).toThrow(/signalIndex/);
  });

  it.each([
    {
      label: 'unfinished signal candle',
      build: () => {
        const input = validInput({ h4Candles: [] });
        const h1Candles = [...input.h1Candles];
        const signal = h1Candles[input.signalIndex];

        if (signal === undefined) {
          throw new RangeError('Expected the signal fixture.');
        }

        h1Candles[input.signalIndex] = buildCandle({
          ...signal,
          isClosed: false,
        });
        return { ...input, h1Candles };
      },
      pattern: /closed/,
    },
    {
      label: 'late signal candle',
      build: () => {
        const input = validInput({ h4Candles: [] });
        const h1Candles = [...input.h1Candles];
        const signal = h1Candles[input.signalIndex];

        if (signal === undefined) {
          throw new RangeError('Expected the signal fixture.');
        }

        h1Candles[input.signalIndex] = buildCandle({
          ...signal,
          availableAt: '2026-01-02T08:00:00Z',
          ingestedAt: '2026-01-02T08:00:00Z',
        });
        return { ...input, h1Candles };
      },
      pattern: /availableAt|computedAt/,
    },
    {
      label: 'zero breakout lookback',
      build: () => validInput({ h4Candles: [], breakoutLookback: 0 }),
      pattern: /lookback/,
    },
    {
      label: 'malformed entry reference',
      build: () =>
        validInput({
          h4Candles: [],
          entryReference: 'not-a-decimal' as DecimalString,
        }),
      pattern: /entryReference/,
    },
    {
      label: 'malformed tick size',
      build: () =>
        validInput({
          h4Candles: [],
          tickSize: 'not-a-decimal' as DecimalString,
        }),
      pattern: /tickSize/,
    },
  ])(
    'validates $label before returning H4 unavailability',
    ({ build, pattern }) => {
      expect(() => evaluateIchimokuDecision(build())).toThrow(pattern);
    },
  );
});
