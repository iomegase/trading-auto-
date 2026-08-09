import { describe, expect, it } from 'vitest';

import {
  assertCandleSeries,
  createCandle,
  type Candle,
  type CandleInput,
} from './index.js';

const validInput: CandleInput = {
  instrumentId: 'TEST',
  timeframe: '1h',
  sourceTimestamp: '2026-01-01T09:00:00+01:00',
  sourceTimezone: 'Europe/Paris',
  exchangeTimezone: 'Europe/Paris',
  openTime: '2026-01-01T08:00:00Z',
  closeTime: '2026-01-01T09:00:00Z',
  availableAt: '2026-01-01T09:00:01Z',
  ingestedAt: '2026-01-01T09:00:02Z',
  open: '100',
  high: '102',
  low: '99',
  close: '101.5',
  isClosed: true,
  provider: 'synthetic',
};

function candle(overrides: Partial<CandleInput> = {}): Readonly<Candle> {
  return createCandle({ ...validInput, ...overrides });
}

describe('assertCandleSeries', () => {
  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a number', 42],
    ['explicit undefined', undefined],
    ['an invalid instrument', { ...validInput, instrumentId: '' }],
    ['an invalid timeframe', { ...validInput, timeframe: '15m' }],
    ['an invalid open instant', { ...validInput, openTime: 'not-an-instant' }],
    [
      'an invalid close instant',
      { ...validInput, closeTime: 'not-an-instant' },
    ],
  ])('rejects %s at index zero', (_label, value) => {
    const action = () => {
      assertCandleSeries([value]);
    };

    expect(action).toThrow(RangeError);
    expect(action).toThrow(/index 0.*valid candle/i);
  });

  it('rejects a sparse array', () => {
    const candles = new Array<Readonly<Candle>>(2);
    candles[0] = candle();

    expect(() => {
      assertCandleSeries(candles);
    }).toThrow(RangeError);
    expect(() => {
      assertCandleSeries(candles);
    }).toThrow(/index 1.*dense/i);
  });

  it('rejects mixed instruments', () => {
    expect(() => {
      assertCandleSeries([candle(), candle({ instrumentId: 'OTHER' })]);
    }).toThrow(/index 1.*instrumentId/i);
  });

  it('rejects mixed timeframes', () => {
    expect(() => {
      assertCandleSeries([candle(), candle({ timeframe: '4h' })]);
    }).toThrow(/index 1.*timeframe/i);
  });

  it('rejects a mismatched expected instrument', () => {
    expect(() => {
      assertCandleSeries([candle()], { instrumentId: 'OTHER' });
    }).toThrow(/index 0.*instrumentId/i);
  });

  it('rejects a mismatched expected timeframe', () => {
    expect(() => {
      assertCandleSeries([candle()], { timeframe: '4h' });
    }).toThrow(/index 0.*timeframe/i);
  });

  it('rejects reordered close times using instant comparison', () => {
    expect(() => {
      assertCandleSeries([
        candle({ closeTime: '2026-01-01T09:00:00Z' }),
        candle({
          openTime: '2026-01-01T06:30:00Z',
          closeTime: '2026-01-01T09:30:00+01:00',
          availableAt: '2026-01-01T08:30:01Z',
        }),
      ]);
    }).toThrow(/index 1.*strictly increasing.*closeTime/i);
  });

  it('rejects equal close times expressed with different offsets', () => {
    expect(() => {
      assertCandleSeries([
        candle(),
        candle({
          openTime: '2026-01-01T08:30:00Z',
          closeTime: '2026-01-01T10:00:00+01:00',
          availableAt: '2026-01-01T09:00:01Z',
        }),
      ]);
    }).toThrow(/index 1.*strictly increasing.*closeTime/i);
  });

  it('rejects overlapping candles', () => {
    expect(() => {
      assertCandleSeries([
        candle(),
        candle({
          openTime: '2026-01-01T08:30:00Z',
          closeTime: '2026-01-01T10:00:00Z',
          availableAt: '2026-01-01T10:00:01Z',
        }),
      ]);
    }).toThrow(/index 1.*openTime.*previous.*closeTime/i);
  });

  it('accepts an empty series', () => {
    expect(() => {
      assertCandleSeries([]);
    }).not.toThrow();
  });

  it('accepts a valid gapped series', () => {
    expect(() => {
      assertCandleSeries(
        [
          candle(),
          candle({
            openTime: '2026-01-01T12:00:00Z',
            closeTime: '2026-01-01T13:00:00Z',
            availableAt: '2026-01-01T13:00:01Z',
          }),
        ],
        { instrumentId: 'TEST', timeframe: '1h' },
      );
    }).not.toThrow();
  });
});
