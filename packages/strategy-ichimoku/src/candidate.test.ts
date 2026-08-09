import {
  asDecimalString,
  asInstantString,
  type Candle,
  type InstantString,
} from '@trading-auto/domain';
import {
  computeIchimoku,
  type IchimokuConfig,
  type IchimokuPoint,
} from '@trading-auto/indicators';
import { buildCandle } from '@trading-auto/test-helpers';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { evaluateH1Candidate, type H1CandidateInput } from './candidate.js';

const decisionAt = asInstantString('2026-01-01T09:00:00Z');
const trendCandleCloseTime = asInstantString('2026-01-01T08:00:00Z');

function candle(
  high: string,
  low: string,
  close: string,
  index = 0,
): Readonly<Candle> {
  const openTime = new Date(Date.UTC(2026, 0, 1, index)).toISOString();
  const closeTime = new Date(Date.UTC(2026, 0, 1, index + 1)).toISOString();

  return buildCandle({
    sourceTimestamp: openTime,
    openTime,
    closeTime,
    availableAt: closeTime,
    ingestedAt: closeTime,
    open: close,
    high,
    low,
    close,
  });
}

function longCandles(
  close = '105',
): readonly [Readonly<Candle>, Readonly<Candle>] {
  return [candle('100', '90', '95'), candle(close, '101', close, 1)];
}

function shortCandles(): readonly [Readonly<Candle>, Readonly<Candle>] {
  return [candle('110', '100', '105'), candle('99', '88', '89', 1)];
}

function point(
  candleValue: Readonly<Candle>,
  overrides: Partial<IchimokuPoint> = {},
): Readonly<IchimokuPoint> {
  return {
    instrumentId: candleValue.instrumentId,
    timeframe: candleValue.timeframe,
    candleCloseTime: candleValue.closeTime,
    computedAt: candleValue.availableAt,
    configVersion: 'candidate-test-v1',
    tenkan: 101,
    kijun: 100,
    kijunPrice: asDecimalString('100'),
    senkouARaw: 99,
    senkouBRaw: 98,
    projectedSenkouA: 99,
    projectedSenkouB: 98,
    currentCloudA: 100,
    currentCloudB: 90,
    currentCloudTop: 100,
    currentCloudBottom: 90,
    projectedCloudTop: 99,
    projectedCloudBottom: 98,
    projectedCloudDirection: 'BULLISH',
    chikouReferenceIndex: 0,
    chikouReferenceClose: 95,
    chikouReferenceHigh: 100,
    chikouReferenceLow: 90,
    kijunSlope: 1,
    ...overrides,
  };
}

function longInput(
  overrides: Partial<H1CandidateInput> = {},
): H1CandidateInput {
  const candles = longCandles();

  return {
    direction: 'LONG',
    regime: 'BULLISH',
    candles,
    index: 1,
    indicator: point(itemAt(candles, 1)),
    breakoutLookback: 1,
    decisionAt,
    trendCandleCloseTime,
    strategyVersion: 'ichimoku-v1',
    datasetVersion: 'dataset-v1',
    ...overrides,
  };
}

function decimalConfiguration() {
  return {
    precision: Decimal.precision,
    rounding: Decimal.rounding,
    toExpNeg: Decimal.toExpNeg,
    toExpPos: Decimal.toExpPos,
    maxE: Decimal.maxE,
    minE: Decimal.minE,
    modulo: Decimal.modulo,
    crypto: Decimal.crypto,
  };
}

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new RangeError(`Expected an item at index ${String(index)}.`);
  }

  return item;
}

describe('evaluateH1Candidate', () => {
  it('approves a LONG candidate when every mandatory condition passes', () => {
    const input = longInput();

    expect(evaluateH1Candidate(input)).toEqual({
      status: 'APPROVED',
      direction: 'LONG',
      decisionAt,
      signalCandleCloseTime: itemAt(input.candles, 1).closeTime,
      trendCandleCloseTime,
      strategyVersion: 'ichimoku-v1',
      datasetVersion: 'dataset-v1',
      indicatorConfigVersion: 'candidate-test-v1',
      reasons: [],
    });
  });

  it('approves a SHORT candidate when every mandatory condition passes', () => {
    const candles = shortCandles();
    const input: H1CandidateInput = {
      ...longInput(),
      direction: 'SHORT',
      regime: 'BEARISH',
      candles,
      indicator: point(itemAt(candles, 1), {
        projectedCloudDirection: 'BEARISH',
        kijunSlope: -1,
      }),
    };

    expect(evaluateH1Candidate(input)).toEqual({
      status: 'APPROVED',
      direction: 'SHORT',
      decisionAt,
      signalCandleCloseTime: itemAt(candles, 1).closeTime,
      trendCandleCloseTime,
      strategyVersion: 'ichimoku-v1',
      datasetVersion: 'dataset-v1',
      indicatorConfigVersion: 'candidate-test-v1',
      reasons: [],
    });
  });

  it.each([
    {
      label: 'LONG trend disagrees',
      input: longInput({ regime: 'NEUTRAL' }),
      reasons: ['TREND_NOT_BULLISH'],
    },
    {
      label: 'LONG price is not above the current Kumo',
      input: (() => {
        const candles = longCandles();
        return longInput({
          candles,
          indicator: point(itemAt(candles, 1), { currentCloudTop: 106 }),
        });
      })(),
      reasons: ['PRICE_NOT_ABOVE_CURRENT_KUMO'],
    },
    {
      label: 'LONG Kijun slope is not positive',
      input: (() => {
        const input = longInput();
        return {
          ...input,
          indicator: point(itemAt(input.candles, 1), { kijunSlope: -1 }),
        };
      })(),
      reasons: ['KIJUN_SLOPE_NOT_POSITIVE'],
    },
    {
      label: 'LONG breakout is not confirmed',
      input: (() => {
        const candles = [
          candle('106', '90', '100'),
          candle('105', '101', '105', 1),
        ];
        return longInput({ candles, indicator: point(itemAt(candles, 1)) });
      })(),
      reasons: ['BREAKOUT_NOT_CONFIRMED'],
    },
    {
      label: 'SHORT trend disagrees',
      input: (() => {
        const candles = shortCandles();
        return longInput({
          direction: 'SHORT',
          regime: 'NEUTRAL',
          candles,
          indicator: point(itemAt(candles, 1), { kijunSlope: -1 }),
        });
      })(),
      reasons: ['TREND_NOT_BEARISH'],
    },
    {
      label: 'SHORT price is not below the current Kumo',
      input: (() => {
        const candles = shortCandles();
        return longInput({
          direction: 'SHORT',
          regime: 'BEARISH',
          candles,
          indicator: point(itemAt(candles, 1), {
            currentCloudBottom: 88,
            kijunSlope: -1,
          }),
        });
      })(),
      reasons: ['PRICE_NOT_BELOW_CURRENT_KUMO'],
    },
    {
      label: 'SHORT Kijun slope is not negative',
      input: (() => {
        const candles = shortCandles();
        return longInput({
          direction: 'SHORT',
          regime: 'BEARISH',
          candles,
          indicator: point(itemAt(candles, 1), { kijunSlope: 1 }),
        });
      })(),
      reasons: ['KIJUN_SLOPE_NOT_NEGATIVE'],
    },
    {
      label: 'SHORT breakout is not confirmed',
      input: (() => {
        const candles = [
          candle('110', '94', '100'),
          candle('99', '95', '95', 1),
        ];
        return longInput({
          direction: 'SHORT',
          regime: 'BEARISH',
          candles,
          indicator: point(itemAt(candles, 1), {
            currentCloudBottom: 96,
            kijunSlope: -1,
          }),
        });
      })(),
      reasons: ['BREAKOUT_NOT_CONFIRMED'],
    },
  ])('returns the exact reason when $label', ({ input, reasons }) => {
    expect(evaluateH1Candidate(input)).toMatchObject({
      status: 'REJECTED',
      reasons,
    });
  });

  it('collects combined failures in deterministic order without duplicates', () => {
    const candles = [candle('110', '90', '100'), candle('105', '95', '100', 1)];
    const input = longInput({
      regime: 'BEARISH',
      candles,
      indicator: point(itemAt(candles, 1), {
        currentCloudTop: 100,
        kijunSlope: 0,
      }),
    });

    expect(evaluateH1Candidate(input).reasons).toEqual([
      'TREND_NOT_BULLISH',
      'PRICE_NOT_ABOVE_CURRENT_KUMO',
      'KIJUN_SLOPE_NOT_POSITIVE',
      'BREAKOUT_NOT_CONFIRMED',
    ]);
  });

  it.each([
    { regime: 'NEUTRAL' as const, reasons: ['TREND_NOT_BULLISH'] },
    { regime: 'INSUFFICIENT_DATA' as const, reasons: ['INSUFFICIENT_DATA'] },
  ])('rejects a $regime regime with stable reasons', ({ regime, reasons }) => {
    expect(evaluateH1Candidate(longInput({ regime })).reasons).toEqual(reasons);
  });

  it.each([
    {
      label: 'current cloud is missing',
      build: () => {
        const input = longInput();
        return {
          ...input,
          indicator: point(itemAt(input.candles, 1), {
            currentCloudTop: null,
          }),
        };
      },
    },
    {
      label: 'Kijun slope is missing',
      build: () => {
        const input = longInput();
        return {
          ...input,
          indicator: point(itemAt(input.candles, 1), { kijunSlope: null }),
        };
      },
    },
    {
      label: 'breakout history is insufficient',
      build: () => longInput({ breakoutLookback: 2 }),
    },
  ])('rejects without throwing when $label', ({ build }) => {
    expect(evaluateH1Candidate(build()).reasons).toEqual(['INSUFFICIENT_DATA']);
  });

  it.each([
    {
      label: 'LONG price equals the cloud top',
      input: (() => {
        const candles = longCandles();
        return longInput({
          candles,
          indicator: point(itemAt(candles, 1), { currentCloudTop: 105 }),
        });
      })(),
      reason: 'PRICE_NOT_ABOVE_CURRENT_KUMO',
    },
    {
      label: 'SHORT price equals the cloud bottom',
      input: (() => {
        const candles = shortCandles();
        return longInput({
          direction: 'SHORT',
          regime: 'BEARISH',
          candles,
          indicator: point(itemAt(candles, 1), {
            currentCloudBottom: 89,
            kijunSlope: -1,
          }),
        });
      })(),
      reason: 'PRICE_NOT_BELOW_CURRENT_KUMO',
    },
    {
      label: 'LONG Kijun slope is zero',
      input: (() => {
        const input = longInput();
        return {
          ...input,
          indicator: point(itemAt(input.candles, 1), { kijunSlope: 0 }),
        };
      })(),
      reason: 'KIJUN_SLOPE_NOT_POSITIVE',
    },
    {
      label: 'SHORT Kijun slope is zero',
      input: (() => {
        const candles = shortCandles();
        return longInput({
          direction: 'SHORT',
          regime: 'BEARISH',
          candles,
          indicator: point(itemAt(candles, 1), { kijunSlope: 0 }),
        });
      })(),
      reason: 'KIJUN_SLOPE_NOT_NEGATIVE',
    },
  ])('uses strict comparisons when $label', ({ input, reason }) => {
    expect(evaluateH1Candidate(input).reasons).toEqual([reason]);
  });

  it('compares a huge DecimalString close exactly', () => {
    const prior = `1${'0'.repeat(400)}`;
    const close = `1${'0'.repeat(399)}1`;
    const candles = [
      candle(prior, prior, prior),
      candle(close, close, close, 1),
    ];

    expect(
      evaluateH1Candidate(
        longInput({
          candles,
          indicator: point(itemAt(candles, 1), {
            currentCloudTop: Number.MAX_VALUE,
          }),
        }),
      ).status,
    ).toBe('APPROVED');
  });

  it('is isolated from ambient Decimal exponent configuration', () => {
    const previousConfiguration = decimalConfiguration();
    const input = longInput();

    try {
      Decimal.set({ maxE: 2, minE: -2 });

      expect(evaluateH1Candidate(input).status).toBe('APPROVED');
    } finally {
      Decimal.set(previousConfiguration);
    }
  });

  it('derives output timestamps, preserves metadata, and freezes the result', () => {
    const input = longInput({
      strategyVersion: 'ichimoku-v2',
      datasetVersion: 'dataset-v2',
    });
    const result = evaluateH1Candidate(input);

    expect(result).toMatchObject({
      decisionAt,
      signalCandleCloseTime: itemAt(input.candles, 1).closeTime,
      trendCandleCloseTime,
      strategyVersion: 'ichimoku-v2',
      datasetVersion: 'dataset-v2',
      indicatorConfigVersion: 'candidate-test-v1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
  });

  it.each([-1, 2, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid index %s',
    (index) => {
      expect(() => evaluateH1Candidate(longInput({ index }))).toThrow(
        RangeError,
      );
    },
  );

  it('rejects an invalid runtime direction', () => {
    const input = {
      ...longInput(),
      direction: 'SIDEWAYS',
    } as unknown as H1CandidateInput;

    expect(() => evaluateH1Candidate(input)).toThrow(/direction/);
  });

  it('rejects an invalid runtime regime', () => {
    const input = {
      ...longInput(),
      regime: 'SIDEWAYS',
    } as unknown as H1CandidateInput;

    expect(() => evaluateH1Candidate(input)).toThrow(/regime/);
  });

  it.each(['', '   '])(
    'rejects blank strategy version %j',
    (strategyVersion) => {
      expect(() => evaluateH1Candidate(longInput({ strategyVersion }))).toThrow(
        /strategyVersion/,
      );
    },
  );

  it.each(['', '   '])('rejects blank dataset version %j', (datasetVersion) => {
    expect(() => evaluateH1Candidate(longInput({ datasetVersion }))).toThrow(
      /datasetVersion/,
    );
  });

  it.each(['', '   '])(
    'rejects blank indicator config version %j',
    (configVersion) => {
      const input = longInput();

      expect(() =>
        evaluateH1Candidate({
          ...input,
          indicator: point(itemAt(input.candles, 1), { configVersion }),
        }),
      ).toThrow(/indicator\.configVersion/);
    },
  );

  it.each([
    ['decisionAt', 'not-an-instant'],
    ['trendCandleCloseTime', 'also-not-an-instant'],
  ] as const)('rejects an invalid %s', (field, value) => {
    const input = {
      ...longInput(),
      [field]: value as InstantString,
    };

    expect(() => evaluateH1Candidate(input)).toThrow(/Instant/);
  });

  it.each([
    { label: 'cloud top', overrides: { currentCloudTop: Number.NaN } },
    {
      label: 'cloud bottom',
      overrides: { currentCloudBottom: Number.POSITIVE_INFINITY },
    },
    {
      label: 'Kijun slope',
      overrides: { kijunSlope: Number.NEGATIVE_INFINITY },
    },
  ])('rejects a non-finite $label', ({ overrides }) => {
    const input = longInput();
    const invalidInput = {
      ...input,
      indicator: point(itemAt(input.candles, 1), overrides),
    };

    expect(() => evaluateH1Candidate(invalidInput)).toThrow(RangeError);
  });

  it('does not mutate any input array or object', () => {
    const input = longInput();
    const candlesBefore = [...input.candles];
    const indicatorBefore = { ...input.indicator };

    evaluateH1Candidate(input);

    expect(input.candles).toEqual(candlesBefore);
    expect(itemAt(input.candles, 0)).toBe(itemAt(candlesBefore, 0));
    expect(itemAt(input.candles, 1)).toBe(itemAt(candlesBefore, 1));
    expect(input.indicator).toEqual(indicatorBefore);
  });

  it('uses the displaced current Kumo from a real Ichimoku point', () => {
    const candles = Array.from({ length: 7 }, (_, index) => {
      const hour = String(index).padStart(2, '0');
      const nextHour = String(index + 1).padStart(2, '0');
      const close = index === 6 ? '20' : '10';

      return buildCandle({
        sourceTimestamp: `2026-01-01 ${hour}:00:00 UTC`,
        openTime: `2026-01-01T${hour}:00:00Z`,
        closeTime: `2026-01-01T${nextHour}:00:00Z`,
        availableAt: `2026-01-01T${nextHour}:00:00Z`,
        ingestedAt: `2026-01-01T${nextHour}:00:00Z`,
        open: close,
        high: index === 6 ? '30' : '10',
        low: close,
        close,
      });
    });
    const config: IchimokuConfig = {
      version: 'candidate-integration-v1',
      tenkanPeriod: 1,
      kijunPeriod: 2,
      senkouBPeriod: 4,
      displacement: 2,
      kijunSlopeLookback: 1,
    };
    const indicator = itemAt(computeIchimoku(candles, config), 6);
    const signalCandle = itemAt(candles, 6);
    const regime = 'BULLISH' as const;

    expect(indicator.currentCloudTop).toBe(10);
    expect(indicator.projectedCloudTop).toBe(22.5);
    expect(Number(signalCandle.close)).toBeLessThan(
      indicator.projectedCloudTop ?? Number.NEGATIVE_INFINITY,
    );
    expect(regime).toBe('BULLISH');
    expect(
      evaluateH1Candidate({
        direction: 'LONG',
        regime,
        candles,
        index: 6,
        indicator,
        breakoutLookback: 2,
        decisionAt: signalCandle.availableAt,
        trendCandleCloseTime: asInstantString('2026-01-01T04:00:00Z'),
        strategyVersion: 'ichimoku-v1',
        datasetVersion: 'dataset-v1',
      }).status,
    ).toBe('APPROVED');
  });

  it('rejects an unfinished H1 signal candle', () => {
    const input = longInput();
    const candles = [...input.candles];
    candles[1] = buildCandle({ ...itemAt(candles, 1), isClosed: false });

    expect(() => evaluateH1Candidate({ ...input, candles })).toThrow(/closed/);
  });

  it('rejects an H1 signal candle that is unavailable at decision time', () => {
    const input = longInput();
    const candles = [...input.candles];
    candles[1] = buildCandle({
      ...itemAt(candles, 1),
      availableAt: '2026-01-01T10:00:00Z',
      ingestedAt: '2026-01-01T10:00:00Z',
    });

    expect(() => evaluateH1Candidate({ ...input, candles })).toThrow(
      /availableAt/,
    );
  });

  it('rejects an H1 signal candle that closes after decision time', () => {
    const input = longInput({
      decisionAt: asInstantString('2026-01-01T01:30:00Z'),
      trendCandleCloseTime: asInstantString('2026-01-01T01:00:00Z'),
    });

    expect(() => evaluateH1Candidate(input)).toThrow(/closeTime/);
  });

  it('rejects a non-H1 signal series', () => {
    const input = longInput();
    const candles = input.candles.map((item) =>
      buildCandle({ ...item, timeframe: '4h' }),
    );
    const indicator = point(itemAt(candles, 1));

    expect(() => evaluateH1Candidate({ ...input, candles, indicator })).toThrow(
      /timeframe/,
    );
  });

  it.each([
    {
      label: 'instrument',
      overrides: { instrumentId: 'OTHER' },
      pattern: /instrumentId/,
    },
    {
      label: 'timeframe',
      overrides: { timeframe: '4h' as const },
      pattern: /timeframe/,
    },
    {
      label: 'candle close time',
      overrides: {
        candleCloseTime: asInstantString('2026-01-01T03:00:00Z'),
      },
      pattern: /candleCloseTime/,
    },
  ])(
    'rejects mismatched indicator $label provenance',
    ({ overrides, pattern }) => {
      const input = longInput();

      expect(() =>
        evaluateH1Candidate({
          ...input,
          indicator: point(itemAt(input.candles, 1), overrides),
        }),
      ).toThrow(pattern);
    },
  );

  it('rejects an indicator computed after decision time', () => {
    const input = longInput();

    expect(() =>
      evaluateH1Candidate({
        ...input,
        indicator: point(itemAt(input.candles, 1), {
          computedAt: asInstantString('2026-01-01T10:00:00Z'),
        }),
      }),
    ).toThrow(/computedAt/);
  });

  it('rejects a trend candle close after decision time', () => {
    expect(() =>
      evaluateH1Candidate(
        longInput({
          trendCandleCloseTime: asInstantString('2026-01-01T10:00:00Z'),
        }),
      ),
    ).toThrow(/trendCandleCloseTime/);
  });

  it('rejects a breakout candle unavailable at decision time', () => {
    const input = longInput();
    const candles = [...input.candles];
    candles[0] = buildCandle({
      ...itemAt(candles, 0),
      availableAt: '2026-01-01T10:00:00Z',
      ingestedAt: '2026-01-01T10:00:00Z',
    });

    expect(() => evaluateH1Candidate({ ...input, candles })).toThrow(
      /breakout.*availableAt/i,
    );
  });

  it('rejects an unfinished prior breakout candle', () => {
    const input = longInput();
    const candles = [...input.candles];
    candles[0] = buildCandle({ ...itemAt(candles, 0), isClosed: false });

    expect(() => evaluateH1Candidate({ ...input, candles })).toThrow(
      /breakout.*closed/i,
    );
  });
});
