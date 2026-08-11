import { Decimal } from 'decimal.js';
import { asDecimalString, type DecimalString } from '@trading-auto/domain';

// Public risk inputs are bounded before Decimal construction. The larger
// private precision leaves ample headroom for exact intermediate arithmetic.
export const MAX_RISK_DECIMAL_TOTAL_DIGITS = 256;
export const MAX_RISK_DECIMAL_FRACTION_DIGITS = 128;
const RiskDecimal = Decimal.clone({
  precision: 1024,
  maxE: 9e15,
  minE: -9e15,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

export function riskDecimalFrom(value: string): Decimal {
  return new RiskDecimal(value);
}

export function isRiskDecimalWithinBounds(value: string): boolean {
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer = '', fraction = ''] = unsigned.split('.');
  return (
    integer.length + fraction.length <= MAX_RISK_DECIMAL_TOTAL_DIGITS &&
    fraction.length <= MAX_RISK_DECIMAL_FRACTION_DIGITS
  );
}

export function riskDecimalToString(value: Decimal): DecimalString {
  return asDecimalString(value.isZero() ? '0' : value.toFixed());
}
