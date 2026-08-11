import { DomainValidationError } from './errors.js';

declare const currencyCodeBrand: unique symbol;

export type CurrencyCode = string & {
  readonly [currencyCodeBrand]: 'CurrencyCode';
};

const CURRENCY_CODE = /^[A-Z]{3}$/;

export function asCurrencyCode(value: string): CurrencyCode {
  if (typeof value !== 'string' || !CURRENCY_CODE.test(value)) {
    throw new DomainValidationError(
      'INVALID_CURRENCY',
      'Currency codes must use exactly three uppercase ASCII letters.',
      { value },
    );
  }

  return value as CurrencyCode;
}
