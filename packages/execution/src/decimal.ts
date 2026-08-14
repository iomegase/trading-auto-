import { asDecimalString, type DecimalString } from '@trading-auto/domain';
import { Decimal } from 'decimal.js';

import { ExecutionInputError } from './errors.js';

const CANONICAL_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const SIGNED_CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const MAX_DECIMAL_DIGITS = 256;
const MAX_DECIMAL_FRACTION_DIGITS = 128;

export const ExecutionDecimal = Decimal.clone({
  defaults: true,
  maxE: 9e15,
  minE: -9e15,
  precision: 1024,
  rounding: Decimal.ROUND_HALF_UP,
  modulo: Decimal.ROUND_DOWN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

function invalid(field: string, value: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_INPUT',
    `${field} must be a positive bounded canonical decimal string.`,
    { field, value },
  );
}

function boundedCanonicalDecimal(
  value: unknown,
  field: string,
  pattern = CANONICAL_DECIMAL,
): DecimalString {
  if (typeof value !== 'string' || !pattern.test(value)) {
    invalid(field, value);
  }

  const [integer, fraction = ''] = value.split('.') as [string, string?];
  if (
    integer.length + fraction.length > MAX_DECIMAL_DIGITS ||
    fraction.length > MAX_DECIMAL_FRACTION_DIGITS
  ) {
    invalid(field, value);
  }

  return asDecimalString(value);
}

export function positiveExecutionDecimal(
  value: unknown,
  field: string,
): DecimalString {
  const canonical = boundedCanonicalDecimal(value, field);

  const decimal = new ExecutionDecimal(canonical);
  if (!decimal.gt(0)) invalid(field, value);

  return canonical;
}

export function nonnegativeExecutionDecimal(
  value: unknown,
  field: string,
): DecimalString {
  return boundedCanonicalDecimal(value, field);
}

export function signedExecutionDecimal(
  value: unknown,
  field: string,
): DecimalString {
  const canonical = boundedCanonicalDecimal(
    value,
    field,
    SIGNED_CANONICAL_DECIMAL,
  );
  const decimal = new ExecutionDecimal(canonical);
  if (decimal.isZero() && canonical.startsWith('-')) {
    invalid(field, value);
  }
  return canonical;
}
