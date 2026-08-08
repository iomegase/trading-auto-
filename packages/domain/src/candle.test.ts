import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  asInstantString,
  createCandle,
  DomainValidationError,
  type CandleInput,
  type DecimalString,
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

function expectDomainValidationError(
  action: () => unknown,
  code: string,
  details: Readonly<Record<string, unknown>>,
): void {
  let received: unknown;

  try {
    action();
  } catch (error) {
    received = error;
  }

  expect(received).toBeInstanceOf(DomainValidationError);
  expect(received).toMatchObject({ code, details });
}

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

  it('preserves a provider-local source timestamp without parsing it', () => {
    const sourceTimestamp = '20260101 09:00:00 Europe/Paris';

    expect(
      createCandle({ ...validInput, sourceTimestamp }).sourceTimestamp,
    ).toBe(sourceTimestamp);
  });

  it('keeps an absent optional volume absent', () => {
    const candle = createCandle(validInput);

    expect('volume' in candle).toBe(false);
  });

  it.each([
    ['absent', {}, undefined],
    ['zero', { volume: '0' }, '0'],
    ['positive', { volume: '250.50' }, '250.50'],
  ] as const)('accepts %s volume', (_description, override, expected) => {
    expect(createCandle({ ...validInput, ...override }).volume).toBe(expected);
  });

  it.each([
    ['explicit undefined', { volume: undefined }],
    ['negative', { volume: '-1' }],
    ['negative zero', { volume: '-0' }],
    ['malformed', { volume: '1e3' }],
  ] as const)('rejects %s volume', (_description, override) => {
    expectDomainValidationError(
      () => createCandle({ ...validInput, ...override } as CandleInput),
      'INVALID_CANDLE',
      { field: 'volume', value: override.volume },
    );
  });

  it('preserves a canonical supplied volume as a branded decimal string', () => {
    const candle = createCandle({ ...validInput, volume: '250.50' });

    expect(candle.volume).toBe('250.50');
    expectTypeOf(candle.volume).toEqualTypeOf<DecimalString | undefined>();
  });

  it('rejects a non-canonical supplied volume', () => {
    expect(() => createCandle({ ...validInput, volume: '1e3' })).toThrow(
      DomainValidationError,
    );
  });

  it('reports high below low before the OHLC envelope violations', () => {
    const createInvalidCandle = () =>
      createCandle({
        ...validInput,
        open: '98',
        high: '98',
        low: '99',
        close: '98',
      });

    expect(createInvalidCandle).toThrow(DomainValidationError);

    try {
      createInvalidCandle();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'HIGH_BELOW_LOW',
        details: { high: '98', low: '99' },
      });
    }
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

  it.each([
    ['a non-object input', null, 'INVALID_CANDLE', { field: 'input' }],
    ['a numeric instrumentId', 42, 'INVALID_CANDLE', { field: 'instrumentId' }],
    ['an empty instrumentId', '', 'INVALID_CANDLE', { field: 'instrumentId' }],
    ['a non-string provider', 42, 'INVALID_CANDLE', { field: 'provider' }],
    ['an empty provider', '', 'INVALID_CANDLE', { field: 'provider' }],
    [
      'a non-string sourceTimestamp',
      42,
      'INVALID_CANDLE',
      { field: 'sourceTimestamp' },
    ],
    [
      'an empty sourceTimestamp',
      '',
      'INVALID_CANDLE',
      { field: 'sourceTimestamp' },
    ],
    [
      'a non-string sourceTimezone',
      42,
      'INVALID_CANDLE',
      { field: 'sourceTimezone' },
    ],
    [
      'an empty sourceTimezone',
      '',
      'INVALID_CANDLE',
      { field: 'sourceTimezone' },
    ],
    [
      'a non-string exchangeTimezone',
      42,
      'INVALID_CANDLE',
      { field: 'exchangeTimezone' },
    ],
    [
      'an empty exchangeTimezone',
      '',
      'INVALID_CANDLE',
      { field: 'exchangeTimezone' },
    ],
    [
      'a non-boolean isClosed',
      'false',
      'INVALID_CANDLE',
      { field: 'isClosed' },
    ],
    ['an invalid timeframe', '15m', 'INVALID_TIMEFRAME', { timeframe: '15m' }],
  ] as const)(
    'rejects %s at the runtime trust boundary',
    (_description, value, code, details) => {
      if (_description === 'a non-object input') {
        expectDomainValidationError(
          () => createCandle(value as unknown as CandleInput),
          code,
          details,
        );
        return;
      }

      const field =
        'field' in details ? (details.field as string) : ('timeframe' as const);

      expectDomainValidationError(
        () =>
          createCandle({
            ...validInput,
            [field]: value,
          }),
        code,
        details,
      );
    },
  );

  it.each([
    'openTime',
    'closeTime',
    'availableAt',
    'ingestedAt',
    'open',
    'high',
    'low',
    'close',
  ] as const)('rejects a non-string %s', (field) => {
    expectDomainValidationError(
      () => createCandle({ ...validInput, [field]: 42 }),
      'INVALID_CANDLE',
      { field },
    );
  });
});
