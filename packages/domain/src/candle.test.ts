import { describe, expect, it } from 'vitest';

import {
  asInstantString,
  createCandle,
  DomainValidationError,
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

describe('asInstantString', () => {
  it('accepts an ISO instant', () => {
    expect(asInstantString('2026-01-01T08:00:00Z')).toBe(
      '2026-01-01T08:00:00Z',
    );
  });

  it.each(['2026-01-01T08:00:00', '2026-01-01', 'not-a-timestamp'])(
    'rejects a non-instant string: %s',
    (value) => {
      expect(() => asInstantString(value)).toThrow(DomainValidationError);
    },
  );
});

describe('createCandle', () => {
  it('creates an immutable candle with validated values', () => {
    const candle = createCandle(validInput);

    expect(candle).toMatchObject(validInput);
    expect(Object.isFrozen(candle)).toBe(true);
    expect(() => {
      (candle as { open: string }).open = '200';
    }).toThrow(TypeError);
  });

  it('keeps an absent optional volume absent', () => {
    const candle = createCandle(validInput);

    expect('volume' in candle).toBe(false);
  });

  it.each([
    ['high below open', { high: '99' }],
    ['high below close', { high: '100' }],
    ['low above open', { low: '101' }],
    ['low above close', { low: '102' }],
    ['high below low', { high: '98' }],
    ['zero open', { open: '0' }],
    ['negative high', { high: '-1' }],
    ['zero low', { low: '0' }],
    ['negative close', { close: '-1' }],
  ] as const)('rejects %s', (_reason, override) => {
    expect(() => createCandle({ ...validInput, ...override })).toThrow(
      DomainValidationError,
    );
  });

  it.each([
    ['same open and close time', { closeTime: validInput.openTime }],
    ['close before open time', { closeTime: '2026-01-01T07:59:59Z' }],
    [
      'closed candle available before close',
      { availableAt: '2026-01-01T08:59:59Z' },
    ],
  ] as const)('rejects %s', (_reason, override) => {
    expect(() => createCandle({ ...validInput, ...override })).toThrow(
      DomainValidationError,
    );
  });
});
