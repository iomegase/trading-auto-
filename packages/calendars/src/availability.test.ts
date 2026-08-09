import { asInstantString, type CandleInput } from '@trading-auto/domain';
import { buildCandle } from '@trading-auto/test-helpers';
import { describe, expect, it } from 'vitest';

import { selectLatestAvailableClosedCandle } from './index.js';

function candleClosingAt(
  closeTime: string,
  availableAt = closeTime,
  isClosed = true,
) {
  return buildCandle({
    openTime: '2026-01-01T07:00:00Z',
    closeTime,
    availableAt,
    ingestedAt: availableAt,
    isClosed,
  });
}

describe('selectLatestAvailableClosedCandle', () => {
  it('omits an undefined volume override from a synthetic candle', () => {
    const overrides: Partial<CandleInput> = {};
    Object.defineProperty(overrides, 'volume', {
      enumerable: true,
      value: undefined,
    });

    expect(buildCandle(overrides)).not.toHaveProperty('volume');
  });

  it('selects the latest closed candle available by the decision time', () => {
    const candleAt0800 = candleClosingAt('2026-01-01T08:00:00Z');
    const candleAt1200 = candleClosingAt('2026-01-01T12:00:00Z');
    const candleAt1600 = candleClosingAt('2026-01-01T16:00:00Z');

    expect(
      selectLatestAvailableClosedCandle(
        [candleAt0800, candleAt1200, candleAt1600],
        asInstantString('2026-01-01T13:00:00Z'),
      ),
    ).toBe(candleAt1200);
  });

  it('excludes an unfinished candle', () => {
    const candleAt1200 = candleClosingAt('2026-01-01T12:00:00Z');
    const unfinishedCandleAt1600 = candleClosingAt(
      '2026-01-01T16:00:00Z',
      '2026-01-01T16:00:00Z',
      false,
    );

    expect(
      selectLatestAvailableClosedCandle(
        [candleAt1200, unfinishedCandleAt1600],
        asInstantString('2026-01-01T17:00:00Z'),
      ),
    ).toBe(candleAt1200);
  });

  it('falls back when the latest closed candle is not yet available', () => {
    const candleAt0800 = candleClosingAt('2026-01-01T08:00:00Z');
    const candleAt1200 = candleClosingAt(
      '2026-01-01T12:00:00Z',
      '2026-01-01T13:05:00Z',
    );

    expect(
      selectLatestAvailableClosedCandle(
        [candleAt0800, candleAt1200],
        asInstantString('2026-01-01T13:00:00Z'),
      ),
    ).toBe(candleAt0800);
  });

  it('includes a candle available exactly at the decision time', () => {
    const candleAt1200 = candleClosingAt(
      '2026-01-01T12:00:00Z',
      '2026-01-01T13:00:00Z',
    );

    expect(
      selectLatestAvailableClosedCandle(
        [candleAt1200],
        asInstantString('2026-01-01T13:00:00Z'),
      ),
    ).toBe(candleAt1200);
  });

  it.each([
    ['there are no candles', []],
    [
      'no candle is eligible',
      [
        candleClosingAt('2026-01-01T12:00:00Z', '2026-01-01T13:01:00Z'),
        candleClosingAt('2026-01-01T11:00:00Z', '2026-01-01T11:00:00Z', false),
      ],
    ],
  ] as const)('returns null when %s', (_description, candles) => {
    expect(
      selectLatestAvailableClosedCandle(
        candles,
        asInstantString('2026-01-01T13:00:00Z'),
      ),
    ).toBeNull();
  });

  it('is independent of array order without mutating a frozen input', () => {
    const candleAt0800 = candleClosingAt('2026-01-01T08:00:00Z');
    const candleAt1200 = candleClosingAt('2026-01-01T12:00:00Z');
    const candles = Object.freeze([candleAt1200, candleAt0800]);
    const decisionAt = asInstantString('2026-01-01T13:00:00Z');

    expect(selectLatestAvailableClosedCandle(candles, decisionAt)).toBe(
      candleAt1200,
    );
    expect(
      selectLatestAvailableClosedCandle([...candles].reverse(), decisionAt),
    ).toBe(candleAt1200);
    expect(candles).toEqual([candleAt1200, candleAt0800]);
  });

  it('retains the first eligible candle when close times tie', () => {
    const first = candleClosingAt('2026-01-01T12:00:00Z');
    const second = candleClosingAt('2026-01-01T12:00:00Z');

    expect(
      selectLatestAvailableClosedCandle(
        [first, second],
        asInstantString('2026-01-01T13:00:00Z'),
      ),
    ).toBe(first);
  });

  it('compares actual instants across equivalent offset spellings', () => {
    const candleAt0800WithOffset = candleClosingAt('2026-01-01T10:00:00+02:00');
    const candleAt0800Utc = candleClosingAt('2026-01-01T08:00:00Z');
    const candleAt0930Utc = candleClosingAt('2026-01-01T09:30:00Z');

    expect(
      selectLatestAvailableClosedCandle(
        [candleAt0930Utc, candleAt0800WithOffset, candleAt0800Utc],
        asInstantString('2026-01-01T10:00:00Z'),
      ),
    ).toBe(candleAt0930Utc);
  });
});
