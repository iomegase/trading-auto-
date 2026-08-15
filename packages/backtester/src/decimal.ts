import { asDecimalString, type DecimalString } from '@trading-auto/domain';
import { Decimal } from 'decimal.js';

import { BacktestInputError } from './errors.js';

const SIGNED_CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const MAX_DECIMAL_TOTAL_DIGITS = 256;
const MAX_DECIMAL_FRACTION_DIGITS = 128;

const BacktestDecimal = Decimal.clone({
  defaults: true,
  precision: 1024,
  rounding: Decimal.ROUND_HALF_UP,
  modulo: Decimal.ROUND_DOWN,
  maxE: 9e15,
  minE: -9e15,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

function invalidDecimal(field: string, value: unknown): never {
  throw new BacktestInputError(
    'INVALID_BACKTEST_INPUT',
    `${field} must be a bounded canonical decimal string.`,
    { field, value },
  );
}

export function asBacktestDecimal(
  value: unknown,
  field: string,
): DecimalString {
  if (typeof value !== 'string' || !SIGNED_CANONICAL_DECIMAL.test(value)) {
    invalidDecimal(field, value);
  }

  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer = '', fraction = ''] = unsigned.split('.');
  if (
    integer.length + fraction.length > MAX_DECIMAL_TOTAL_DIGITS ||
    fraction.length > MAX_DECIMAL_FRACTION_DIGITS
  ) {
    invalidDecimal(field, value);
  }

  const decimal = new BacktestDecimal(value);
  if (decimal.isZero() && value.startsWith('-')) invalidDecimal(field, value);
  return asDecimalString(value);
}

export function asBacktestNonnegativeDecimal(
  value: unknown,
  field: string,
): DecimalString {
  const result = asBacktestDecimal(value, field);
  if (new BacktestDecimal(result).isNegative()) invalidDecimal(field, value);
  return result;
}

export function asBacktestPositiveDecimal(
  value: unknown,
  field: string,
): DecimalString {
  const result = asBacktestDecimal(value, field);
  if (!new BacktestDecimal(result).gt(0)) invalidDecimal(field, value);
  return result;
}

function decimalString(value: Decimal): DecimalString {
  return asDecimalString(value.isZero() ? '0' : value.toFixed());
}

export function decimalSum(values: readonly string[]): DecimalString {
  let result = new BacktestDecimal(0);
  for (const [index, value] of values.entries()) {
    result = result.plus(asBacktestDecimal(value, `values[${String(index)}]`));
  }
  return decimalString(result);
}

export function decimalCompare(left: string, right: string): -1 | 0 | 1 {
  const comparison = new BacktestDecimal(asBacktestDecimal(left, 'left')).cmp(
    asBacktestDecimal(right, 'right'),
  );
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
}
