import { Decimal } from 'decimal.js';

import { DomainValidationError } from './errors.js';

declare const decimalStringBrand: unique symbol;

export type DecimalString = string & {
  readonly [decimalStringBrand]: 'DecimalString';
};

const CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export function asDecimalString(value: string): DecimalString {
  if (typeof value !== 'string' || !CANONICAL_DECIMAL.test(value)) {
    throw new DomainValidationError(
      'INVALID_DECIMAL',
      'Decimal strings must use canonical decimal notation.',
      { value },
    );
  }

  try {
    if (!new Decimal(value).isFinite()) {
      throw new DomainValidationError(
        'INVALID_DECIMAL',
        'Decimal strings must be finite.',
        { value },
      );
    }
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw error;
    }

    throw new DomainValidationError(
      'INVALID_DECIMAL',
      'Decimal strings must be finite.',
      { value },
    );
  }

  return value as DecimalString;
}
