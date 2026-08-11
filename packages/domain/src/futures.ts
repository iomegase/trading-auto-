import { Temporal } from '@js-temporal/polyfill';

import { asCurrencyCode, type CurrencyCode } from './currency.js';
import { asDecimalString, decimalFrom, type DecimalString } from './decimal.js';
import { DomainValidationError } from './errors.js';
import { asInstantString, type InstantString } from './time.js';

export type SettlementType = 'CASH' | 'PHYSICAL';

export interface FuturesProductInput {
  productCode: string;
  exchange: string;
  underlyingId: string;
  quoteCurrency: string;
  pnlCurrency: string;
  tickSize: string;
  tickValue: string;
  monetaryValuePerPriceUnit: string;
  quantityStep: string;
  minQuantity: string;
  riskGroup: string;
}

export interface FuturesProduct {
  readonly productCode: string;
  readonly exchange: string;
  readonly underlyingId: string;
  readonly quoteCurrency: CurrencyCode;
  readonly pnlCurrency: CurrencyCode;
  readonly tickSize: DecimalString;
  readonly tickValue: DecimalString;
  readonly monetaryValuePerPriceUnit: DecimalString;
  readonly quantityStep: DecimalString;
  readonly minQuantity: DecimalString;
  readonly riskGroup: string;
}

export interface FuturesContractInput {
  contractId: string;
  productCode: string;
  firstTradeAt: string;
  lastTradeAt: string;
  expiryAt: string;
  settlementType: SettlementType;
}

export interface FuturesContract {
  readonly contractId: string;
  readonly productCode: string;
  readonly firstTradeAt: InstantString;
  readonly lastTradeAt: InstantString;
  readonly expiryAt: InstantString;
  readonly settlementType: SettlementType;
}

type UnknownFuturesProductInput = {
  [Field in keyof FuturesProductInput]: unknown;
};

type UnknownFuturesContractInput = {
  [Field in keyof FuturesContractInput]: unknown;
};

const MAX_ECONOMIC_DECIMAL_DIGITS = 256;
const MAX_ECONOMIC_DECIMAL_SCALE = 128;

function invalidProduct(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new DomainValidationError('INVALID_FUTURES_PRODUCT', message, details);
}

function invalidContract(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new DomainValidationError('INVALID_FUTURES_CONTRACT', message, details);
}

function assertObject(
  value: unknown,
  invalid: (
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) => never,
  field: string,
): asserts value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid(`${field} must be an object.`, { field });
    }
  } catch {
    invalid(`${field} must be an object.`, { field });
  }
}

function snapshotProperty(
  input: Record<string, unknown>,
  field: string,
  invalid: (
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) => never,
): unknown {
  try {
    return input[field];
  } catch {
    invalid(`${field} must be readable.`, { field });
  }
}

function assertString(
  value: unknown,
  field: string,
  invalid: (
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) => never,
): asserts value is string {
  if (typeof value !== 'string') {
    invalid(`${field} must be a string.`, { field, value });
  }
}

function assertNonEmptyString(
  value: unknown,
  field: string,
  invalid: (
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) => never,
): asserts value is string {
  assertString(value, field, invalid);

  if (value.trim().length === 0) {
    invalid(`${field} must be a non-empty string.`, { field, value });
  }
}

function positiveDecimal(value: string, field: string): DecimalString {
  let decimal: DecimalString;

  try {
    decimal = asDecimalString(value);
  } catch {
    invalidProduct(`${field} must be a canonical decimal.`, { field, value });
  }

  assertEconomicDecimalBounds(decimal, field);

  if (decimalFrom(decimal).lte(0)) {
    invalidProduct(`${field} must be greater than zero.`, { field, value });
  }

  return decimal;
}

function assertEconomicDecimalBounds(
  value: DecimalString,
  field: string,
): void {
  const decimalPoint = value.indexOf('.');
  const fractionalScale =
    decimalPoint === -1 ? 0 : value.length - decimalPoint - 1;
  const totalDigits = value.length - (decimalPoint === -1 ? 0 : 1);

  if (
    totalDigits > MAX_ECONOMIC_DECIMAL_DIGITS ||
    fractionalScale > MAX_ECONOMIC_DECIMAL_SCALE
  ) {
    invalidProduct(
      `${field} exceeds the supported futures economic decimal bounds.`,
      { field, value },
    );
  }
}

function positiveIntegerDecimal(value: string, field: string): DecimalString {
  const decimal = positiveDecimal(value, field);

  if (!decimalFrom(decimal).isInteger()) {
    invalidProduct(`${field} must be a positive integer.`, { field, value });
  }

  return decimal;
}

function scaledInteger(value: DecimalString): {
  coefficient: bigint;
  scale: number;
} {
  const decimalPoint = value.indexOf('.');
  const fractionalPart =
    decimalPoint === -1 ? '' : value.slice(decimalPoint + 1);
  const digits =
    decimalPoint === -1 ? value : value.slice(0, decimalPoint) + fractionalPart;

  let coefficient = BigInt(digits);
  let scale = fractionalPart.length;

  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }

  return { coefficient, scale };
}

function powersOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function hasExactTickEconomics(
  tickSize: DecimalString,
  tickValue: DecimalString,
  monetaryValuePerPriceUnit: DecimalString,
): boolean {
  const tickSizeInteger = scaledInteger(tickSize);
  const tickValueInteger = scaledInteger(tickValue);
  const monetaryValueInteger = scaledInteger(monetaryValuePerPriceUnit);
  const productScale = tickSizeInteger.scale + monetaryValueInteger.scale;
  const sharedScale = Math.min(productScale, tickValueInteger.scale);

  return (
    tickValueInteger.coefficient * powersOfTen(productScale - sharedScale) ===
    tickSizeInteger.coefficient *
      monetaryValueInteger.coefficient *
      powersOfTen(tickValueInteger.scale - sharedScale)
  );
}

function snapshotProductInput(input: unknown): UnknownFuturesProductInput {
  assertObject(input, invalidProduct, 'input');

  return {
    productCode: snapshotProperty(input, 'productCode', invalidProduct),
    exchange: snapshotProperty(input, 'exchange', invalidProduct),
    underlyingId: snapshotProperty(input, 'underlyingId', invalidProduct),
    quoteCurrency: snapshotProperty(input, 'quoteCurrency', invalidProduct),
    pnlCurrency: snapshotProperty(input, 'pnlCurrency', invalidProduct),
    tickSize: snapshotProperty(input, 'tickSize', invalidProduct),
    tickValue: snapshotProperty(input, 'tickValue', invalidProduct),
    monetaryValuePerPriceUnit: snapshotProperty(
      input,
      'monetaryValuePerPriceUnit',
      invalidProduct,
    ),
    quantityStep: snapshotProperty(input, 'quantityStep', invalidProduct),
    minQuantity: snapshotProperty(input, 'minQuantity', invalidProduct),
    riskGroup: snapshotProperty(input, 'riskGroup', invalidProduct),
  };
}

function validateProductInput(input: unknown): FuturesProductInput {
  const snapshot = snapshotProductInput(input);

  assertNonEmptyString(snapshot.productCode, 'productCode', invalidProduct);
  assertNonEmptyString(snapshot.exchange, 'exchange', invalidProduct);
  assertNonEmptyString(snapshot.underlyingId, 'underlyingId', invalidProduct);
  assertString(snapshot.quoteCurrency, 'quoteCurrency', invalidProduct);
  assertString(snapshot.pnlCurrency, 'pnlCurrency', invalidProduct);
  assertString(snapshot.tickSize, 'tickSize', invalidProduct);
  assertString(snapshot.tickValue, 'tickValue', invalidProduct);
  assertString(
    snapshot.monetaryValuePerPriceUnit,
    'monetaryValuePerPriceUnit',
    invalidProduct,
  );
  assertString(snapshot.quantityStep, 'quantityStep', invalidProduct);
  assertString(snapshot.minQuantity, 'minQuantity', invalidProduct);
  assertNonEmptyString(snapshot.riskGroup, 'riskGroup', invalidProduct);

  return snapshot as unknown as FuturesProductInput;
}

function snapshotContractInput(input: unknown): UnknownFuturesContractInput {
  assertObject(input, invalidContract, 'input');

  return {
    contractId: snapshotProperty(input, 'contractId', invalidContract),
    productCode: snapshotProperty(input, 'productCode', invalidContract),
    firstTradeAt: snapshotProperty(input, 'firstTradeAt', invalidContract),
    lastTradeAt: snapshotProperty(input, 'lastTradeAt', invalidContract),
    expiryAt: snapshotProperty(input, 'expiryAt', invalidContract),
    settlementType: snapshotProperty(input, 'settlementType', invalidContract),
  };
}

function validateContractInput(input: unknown): FuturesContractInput {
  const snapshot = snapshotContractInput(input);

  assertNonEmptyString(snapshot.contractId, 'contractId', invalidContract);
  assertNonEmptyString(snapshot.productCode, 'productCode', invalidContract);
  assertString(snapshot.firstTradeAt, 'firstTradeAt', invalidContract);
  assertString(snapshot.lastTradeAt, 'lastTradeAt', invalidContract);
  assertString(snapshot.expiryAt, 'expiryAt', invalidContract);

  if (
    snapshot.settlementType !== 'CASH' &&
    snapshot.settlementType !== 'PHYSICAL'
  ) {
    invalidContract('settlementType must be CASH or PHYSICAL.', {
      field: 'settlementType',
      value: snapshot.settlementType,
    });
  }

  return snapshot as FuturesContractInput;
}

function validateProductArgument(product: unknown): string {
  assertObject(product, invalidContract, 'product');
  const productCode = snapshotProperty(product, 'productCode', invalidContract);
  assertNonEmptyString(productCode, 'productCode', invalidContract);
  return productCode;
}

export function createFuturesProduct(
  input: FuturesProductInput,
): Readonly<FuturesProduct> {
  const validatedInput = validateProductInput(input);
  const quoteCurrency = asCurrencyCode(validatedInput.quoteCurrency);
  const pnlCurrency = asCurrencyCode(validatedInput.pnlCurrency);
  const tickSize = positiveDecimal(validatedInput.tickSize, 'tickSize');
  const tickValue = positiveDecimal(validatedInput.tickValue, 'tickValue');
  const monetaryValuePerPriceUnit = positiveDecimal(
    validatedInput.monetaryValuePerPriceUnit,
    'monetaryValuePerPriceUnit',
  );
  const quantityStep = positiveIntegerDecimal(
    validatedInput.quantityStep,
    'quantityStep',
  );
  const minQuantity = positiveIntegerDecimal(
    validatedInput.minQuantity,
    'minQuantity',
  );

  if (!decimalFrom(minQuantity).mod(decimalFrom(quantityStep)).isZero()) {
    invalidProduct('minQuantity must be divisible by quantityStep.', {
      quantityStep,
      minQuantity,
    });
  }

  if (!hasExactTickEconomics(tickSize, tickValue, monetaryValuePerPriceUnit)) {
    invalidProduct(
      'tickValue divided by tickSize must equal monetaryValuePerPriceUnit.',
      { tickSize, tickValue, monetaryValuePerPriceUnit },
    );
  }

  return Object.freeze({
    productCode: validatedInput.productCode,
    exchange: validatedInput.exchange,
    underlyingId: validatedInput.underlyingId,
    quoteCurrency,
    pnlCurrency,
    tickSize,
    tickValue,
    monetaryValuePerPriceUnit,
    quantityStep,
    minQuantity,
    riskGroup: validatedInput.riskGroup,
  });
}

export function createFuturesContract(
  input: FuturesContractInput,
  product: FuturesProduct,
): Readonly<FuturesContract> {
  const validatedInput = validateContractInput(input);
  const validatedProductCode = validateProductArgument(product);

  if (validatedInput.productCode !== validatedProductCode) {
    invalidContract(
      'productCode must equal the validated product productCode.',
      {
        productCode: validatedInput.productCode,
        expectedProductCode: validatedProductCode,
      },
    );
  }

  const firstTradeAt = asInstantString(validatedInput.firstTradeAt);
  const lastTradeAt = asInstantString(validatedInput.lastTradeAt);
  const expiryAt = asInstantString(validatedInput.expiryAt);

  if (Temporal.Instant.compare(firstTradeAt, lastTradeAt) >= 0) {
    invalidContract('firstTradeAt must be before lastTradeAt.', {
      firstTradeAt,
      lastTradeAt,
    });
  }

  if (Temporal.Instant.compare(lastTradeAt, expiryAt) > 0) {
    invalidContract('lastTradeAt must not be after expiryAt.', {
      lastTradeAt,
      expiryAt,
    });
  }

  return Object.freeze({
    contractId: validatedInput.contractId,
    productCode: validatedInput.productCode,
    firstTradeAt,
    lastTradeAt,
    expiryAt,
    settlementType: validatedInput.settlementType,
  });
}
