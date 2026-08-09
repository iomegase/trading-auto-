import {
  asDecimalString,
  asInstantString,
  type Candle,
} from '@trading-auto/domain';
import type { IchimokuPoint } from '@trading-auto/indicators';
import { buildCandle } from '@trading-auto/test-helpers';
import { describe, expect, it } from 'vitest';

import { selectLatestAvailableH4Snapshot } from './index.js';

function h4Candle(
  index: number,
  overrides: Parameters<typeof buildCandle>[0] = {},
): Readonly<Candle> {
  const openHour = index * 4;
  const closeHour = openHour + 4;
  const openTime = new Date(Date.UTC(2026, 0, 1, openHour)).toISOString();
  const closeTime = new Date(Date.UTC(2026, 0, 1, closeHour)).toISOString();

  return buildCandle({
    timeframe: '4h',
    sourceTimestamp: openTime,
    openTime,
    closeTime,
    availableAt: closeTime,
    ingestedAt: closeTime,
    ...overrides,
  });
}

function pointFor(
  candle: Readonly<Candle>,
  overrides: Partial<IchimokuPoint> = {},
): Readonly<IchimokuPoint> {
  return Object.freeze({
    instrumentId: candle.instrumentId,
    timeframe: candle.timeframe,
    candleCloseTime: candle.closeTime,
    computedAt: candle.availableAt,
    configVersion: 'h4-baseline-v1',
    tenkan: 101,
    kijun: 100,
    kijunPrice: asDecimalString('100'),
    senkouARaw: 99,
    senkouBRaw: 98,
    projectedSenkouA: 99,
    projectedSenkouB: 98,
    currentCloudA: 97,
    currentCloudB: 96,
    currentCloudTop: 97,
    currentCloudBottom: 96,
    projectedCloudTop: 99,
    projectedCloudBottom: 98,
    projectedCloudDirection: 'BULLISH',
    chikouReferenceIndex: 0,
    chikouReferenceClose: 95,
    chikouReferenceHigh: 96,
    chikouReferenceLow: 94,
    kijunSlope: 1,
    ...overrides,
  });
}

describe('selectLatestAvailableH4Snapshot', () => {
  it('selects the latest closed H4 candle and aligned available snapshot', () => {
    const first = h4Candle(0);
    const second = h4Candle(1);

    expect(
      selectLatestAvailableH4Snapshot(
        [first, second],
        [pointFor(first), pointFor(second)],
        asInstantString('2026-01-01T08:00:00Z'),
        'TEST',
      ),
    ).toEqual({ status: 'SELECTED', candle: second, point: pointFor(second) });
  });

  it('includes candle and snapshot exactly at the decision boundary', () => {
    const candle = h4Candle(0);

    expect(
      selectLatestAvailableH4Snapshot(
        [candle],
        [pointFor(candle)],
        candle.availableAt,
        'TEST',
      ).status,
    ).toBe('SELECTED');
  });

  it.each([
    ['empty input', [], []],
    [
      'unfinished candle',
      [h4Candle(0, { isClosed: false })],
      [pointFor(h4Candle(0, { isClosed: false }))],
    ],
    [
      'late candle',
      [
        h4Candle(0, {
          availableAt: '2026-01-01T05:00:00Z',
          ingestedAt: '2026-01-01T05:00:00Z',
        }),
      ],
      [
        pointFor(
          h4Candle(0, {
            availableAt: '2026-01-01T05:00:00Z',
            ingestedAt: '2026-01-01T05:00:00Z',
          }),
        ),
      ],
    ],
  ] as const)(
    'returns NO_CLOSED_TREND_CANDLE for $0',
    (_label, candles, points) => {
      expect(
        selectLatestAvailableH4Snapshot(
          candles,
          points,
          asInstantString('2026-01-01T04:30:00Z'),
          'TEST',
        ),
      ).toEqual({
        status: 'UNAVAILABLE',
        reason: 'NO_CLOSED_TREND_CANDLE',
      });
    },
  );

  it.each([
    {
      label: 'snapshot is not available',
      overrides: { computedAt: asInstantString('2026-01-01T05:00:00Z') },
    },
    {
      label: 'current Kumo is incomplete',
      overrides: { currentCloudTop: null },
    },
    { label: 'Kijun slope is incomplete', overrides: { kijunSlope: null } },
    {
      label: 'projected cloud is incomplete',
      overrides: { projectedCloudDirection: 'INSUFFICIENT_DATA' as const },
    },
  ])('returns INSUFFICIENT_DATA when $label', ({ overrides }) => {
    const candle = h4Candle(0);

    expect(
      selectLatestAvailableH4Snapshot(
        [candle],
        [pointFor(candle, overrides)],
        asInstantString('2026-01-01T04:30:00Z'),
        'TEST',
      ),
    ).toEqual({ status: 'UNAVAILABLE', reason: 'INSUFFICIENT_DATA' });
  });

  it.each([
    ['array length mismatch', [h4Candle(0)], []],
    ['wrong timeframe', [buildCandle()], [pointFor(buildCandle())]],
    [
      'wrong instrument',
      [h4Candle(0, { instrumentId: 'OTHER' })],
      [pointFor(h4Candle(0, { instrumentId: 'OTHER' }))],
    ],
    [
      'snapshot instrument mismatch',
      [h4Candle(0)],
      [pointFor(h4Candle(0), { instrumentId: 'OTHER' })],
    ],
    [
      'snapshot timeframe mismatch',
      [h4Candle(0)],
      [pointFor(h4Candle(0), { timeframe: '1h' })],
    ],
    [
      'snapshot close mismatch',
      [h4Candle(0)],
      [
        pointFor(h4Candle(0), {
          candleCloseTime: asInstantString('2026-01-01T05:00:00Z'),
        }),
      ],
    ],
  ] as const)('rejects $0', (_label, candles, points) => {
    expect(() =>
      selectLatestAvailableH4Snapshot(
        candles,
        points,
        asInstantString('2026-01-01T08:00:00Z'),
        'TEST',
      ),
    ).toThrow(RangeError);
  });

  it('returns INSUFFICIENT_DATA when the selected snapshot prefix contains an unfinished candle', () => {
    const unfinished = h4Candle(0, { isClosed: false });
    const selected = h4Candle(1);

    expect(
      selectLatestAvailableH4Snapshot(
        [unfinished, selected],
        [pointFor(unfinished), pointFor(selected)],
        selected.availableAt,
        'TEST',
      ),
    ).toEqual({ status: 'UNAVAILABLE', reason: 'INSUFFICIENT_DATA' });
  });

  it('rejects a snapshot computedAt that is not the maximum prefix availability', () => {
    const lateHistorical = h4Candle(0, {
      availableAt: '2026-01-01T09:00:00Z',
      ingestedAt: '2026-01-01T09:00:00Z',
    });
    const current = h4Candle(1);

    expect(() =>
      selectLatestAvailableH4Snapshot(
        [lateHistorical, current],
        [pointFor(lateHistorical), pointFor(current)],
        asInstantString('2026-01-01T10:00:00Z'),
        'TEST',
      ),
    ).toThrow(/computedAt/);
  });
});
