import { Decimal } from 'decimal.js';

const RiskDecimal = Decimal.clone({
  maxE: 9e15,
  minE: -9e15,
});

export function riskDecimalFrom(value: string): Decimal {
  return new RiskDecimal(value);
}
