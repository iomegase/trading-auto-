import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  asDecimalString,
  createCandle,
  DomainValidationError,
  type CandleInput,
} from './index.js';

const validCandleInput: CandleInput = {
  instrumentId: 'TEST',
  timeframe: '1h',
  sourceTimestamp: '2026-01-01T09:00:00+01:00',
  sourceTimezone: 'Europe/Paris',
  exchangeTimezone: 'Europe/Paris',
  openTime: '2026-01-01T08:00:00Z',
  closeTime: '2026-01-01T09:00:00Z',
  availableAt: '2026-01-01T09:00:01Z',
  ingestedAt: '2026-01-01T09:00:02Z',
  open: '1000',
  high: '1002',
  low: '999',
  close: '1001',
  isClosed: true,
  provider: 'synthetic',
};

describe('asDecimalString', () => {
  it('preserves a canonical decimal string', () => {
    expect(asDecimalString('101.50')).toBe('101.50');
  });

  it.each([
    '+1',
    '1e3',
    '01',
    '-01',
    '1.',
    'NaN',
    'Infinity',
    '-Infinity',
    '',
    'not-a-number',
  ])('rejects non-canonical decimal text: %s', (value) => {
    expect(() => asDecimalString(value)).toThrow(DomainValidationError);
  });

  it('is independent of ambient Decimal exponent settings', () => {
    const originalConfig = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
      minE: Decimal.minE,
      maxE: Decimal.maxE,
      modulo: Decimal.modulo,
      crypto: Decimal.crypto,
    };

    try {
      Decimal.set({ maxE: 2 });

      expect(asDecimalString('1000')).toBe('1000');
      expect(createCandle(validCandleInput)).toMatchObject({
        open: '1000',
        high: '1002',
        low: '999',
        close: '1001',
      });
    } finally {
      Decimal.set(originalConfig);
    }
  });
});
