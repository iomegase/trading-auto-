import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  asCurrencyCode,
  DomainValidationError,
  type CurrencyCode,
} from './index.js';

function expectCurrencyError(value: unknown): void {
  let received: unknown;

  try {
    asCurrencyCode(value as string);
  } catch (error) {
    received = error;
  }

  expect(received).toBeInstanceOf(DomainValidationError);
  expect(received).toMatchObject({
    code: 'INVALID_CURRENCY',
    details: { value },
  });
}

describe('asCurrencyCode', () => {
  it('accepts canonical three-letter currencies', () => {
    expect(asCurrencyCode('EUR')).toBe('EUR');
    expect(asCurrencyCode('USD')).toBe('USD');
    expectTypeOf(asCurrencyCode('EUR')).toEqualTypeOf<CurrencyCode>();
  });

  it.each(['eur', 'EU', 'EURO', ' EUR ', '', '12A', 42, null])(
    'rejects an invalid currency value: %s',
    (value) => {
      expectCurrencyError(value);
    },
  );
});
