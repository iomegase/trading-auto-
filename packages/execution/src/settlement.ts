import {
  asCurrencyCode,
  asInstantString,
  type CurrencyCode,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import { Temporal } from '@js-temporal/polyfill';

import {
  ExecutionDecimal,
  positiveExecutionDecimal,
  signedExecutionDecimal,
} from './decimal.js';
import { ExecutionInputError } from './errors.js';
import {
  executionLimitations,
  type ExecutionLimitation,
} from './limitations.js';
import { snapshotOpenPosition, type OpenPosition } from './position.js';

const MAX_SETTLEMENTS = 10_000;

export interface DailySettlementInput {
  version: string;
  source: string;
  observedAt: string;
  effectiveAt: string;
  contractId: string;
  currency: string;
  price: string;
}

export interface DailySettlement {
  readonly version: string;
  readonly source: string;
  readonly observedAt: InstantString;
  readonly effectiveAt: InstantString;
  readonly contractId: string;
  readonly currency: CurrencyCode;
  readonly price: DecimalString;
}

export interface DailySettlementConstraintsInput {
  readonly contractId: string;
  readonly currency: string;
  readonly tickSize: string;
}

export interface SelectDailySettlementInput {
  readonly settlements: readonly Readonly<DailySettlement>[];
  readonly requiredEffectiveAt: string;
  readonly decisionAt: string;
  readonly constraints: Readonly<DailySettlementConstraintsInput>;
}

export interface ApplyDailySettlementInput {
  readonly position: Readonly<OpenPosition>;
  readonly settlement: Readonly<DailySettlement>;
  readonly decisionAt: string;
  readonly currency: string;
  readonly monetaryValuePerPriceUnit: string;
  readonly cash: string;
  readonly realizedEquity: string;
}

export interface DailySettlementApplied {
  readonly type: 'DAILY_SETTLEMENT_APPLIED';
  readonly positionId: string;
  readonly contractId: string;
  readonly effectiveAt: InstantString;
  readonly availableAt: InstantString;
  readonly currency: CurrencyCode;
  readonly previousAccountingBasisPrice: DecimalString;
  readonly settlementPrice: DecimalString;
  readonly variationMargin: DecimalString;
  readonly cashBefore: DecimalString;
  readonly cashAfter: DecimalString;
  readonly realizedEquityBefore: DecimalString;
  readonly realizedEquityAfter: DecimalString;
  readonly position: Readonly<OpenPosition>;
  readonly limitations: readonly ExecutionLimitation[];
}

const settlementFields = Object.freeze([
  'version',
  'source',
  'observedAt',
  'effectiveAt',
  'contractId',
  'currency',
  'price',
] as const);

const constraintFields = Object.freeze([
  'contractId',
  'currency',
  'tickSize',
] as const);

function invalid(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_INPUT',
    `${field} is invalid for daily settlement.`,
    { field, value },
  );
}

function dataError(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_DATA',
    `${field} is missing or unavailable in the settlement dataset.`,
    { field, value },
  );
}

function assertPlainRecord(
  value: unknown,
  field: string,
  fail: (field: string, value?: unknown) => never = invalid,
): asserts value is object {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(field);
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) fail(field);
  } catch {
    fail(field);
  }
}

function ownValue(
  input: object,
  field: string,
  fail: (field: string, value?: unknown) => never = invalid,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, field);
  } catch {
    fail(field);
  }
  if (descriptor === undefined || !descriptor.enumerable) fail(field);
  if ('value' in descriptor) return descriptor.value;
  if (descriptor.get === undefined) return undefined;
  try {
    return descriptor.get.call(input);
  } catch {
    fail(field);
  }
}

function snapshot(
  value: unknown,
  field: string,
  fields: readonly string[],
  fail: (field: string, value?: unknown) => never = invalid,
): Readonly<Record<string, unknown>> {
  assertPlainRecord(value, field, fail);
  const result: Record<string, unknown> = {};
  for (const item of fields) result[item] = ownValue(value, item, fail);
  return Object.freeze(result);
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(field, value);
  }
  return value;
}

function instant(
  value: unknown,
  field: string,
  fail: (field: string, value?: unknown) => never = invalid,
): InstantString {
  if (typeof value !== 'string') fail(field, value);
  try {
    return asInstantString(value);
  } catch {
    fail(field, value);
  }
}

function currency(value: unknown, field: string): CurrencyCode {
  if (typeof value !== 'string') invalid(field, value);
  try {
    return asCurrencyCode(value);
  } catch {
    invalid(field, value);
  }
}

function compare(left: InstantString, right: InstantString): number {
  return Temporal.Instant.compare(left, right);
}

function constraints(input: unknown): Readonly<{
  contractId: string;
  currency: CurrencyCode;
  tickSize: DecimalString;
}> {
  const value = snapshot(input, 'constraints', constraintFields);
  return Object.freeze({
    contractId: nonBlank(value.contractId, 'contractId'),
    currency: currency(value.currency, 'currency'),
    tickSize: positiveExecutionDecimal(value.tickSize, 'tickSize'),
  });
}

export function createDailySettlement(
  input: DailySettlementInput,
  expected: DailySettlementConstraintsInput,
): Readonly<DailySettlement> {
  const raw = snapshot(input, 'input', settlementFields);
  const boundary = constraints(expected);
  const version = nonBlank(raw.version, 'version');
  const source = nonBlank(raw.source, 'source');
  const observedAt = instant(raw.observedAt, 'observedAt');
  const effectiveAt = instant(raw.effectiveAt, 'effectiveAt');
  const contractId = nonBlank(raw.contractId, 'contractId');
  const settlementCurrency = currency(raw.currency, 'currency');
  const price = positiveExecutionDecimal(raw.price, 'price');

  if (contractId !== boundary.contractId) invalid('contractId', contractId);
  if (settlementCurrency !== boundary.currency) {
    invalid('currency', settlementCurrency);
  }
  if (!new ExecutionDecimal(price).mod(boundary.tickSize).isZero()) {
    invalid('price', price);
  }
  if (compare(observedAt, effectiveAt) < 0) invalid('observedAt', observedAt);

  return Object.freeze({
    version,
    source,
    observedAt,
    effectiveAt,
    contractId,
    currency: settlementCurrency,
    price,
  });
}

function denseSettlements(value: unknown): readonly unknown[] {
  let length: number;
  try {
    if (!Array.isArray(value)) dataError('settlements');
    length = value.length;
  } catch {
    dataError('settlements');
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_SETTLEMENTS) {
    dataError('settlements', { length, maximum: MAX_SETTLEMENTS });
  }
  const result: unknown[] = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      dataError('settlements', { index });
    }
    if (descriptor === undefined || !descriptor.enumerable) {
      dataError('settlements', { index });
    }
    if ('value' in descriptor) {
      result[index] = descriptor.value;
    } else if (descriptor.get === undefined) {
      result[index] = undefined;
    } else {
      try {
        result[index] = descriptor.get.call(value);
      } catch {
        dataError('settlements', { index });
      }
    }
  }
  return result;
}

export function selectDailySettlement(
  input: SelectDailySettlementInput,
): Readonly<DailySettlement> {
  assertPlainRecord(input, 'input', dataError);
  const settlements = denseSettlements(
    ownValue(input, 'settlements', dataError),
  );
  const requiredEffectiveAt = instant(
    ownValue(input, 'requiredEffectiveAt', dataError),
    'requiredEffectiveAt',
    dataError,
  );
  const decisionAt = instant(
    ownValue(input, 'decisionAt', dataError),
    'decisionAt',
    dataError,
  );
  let expected: ReturnType<typeof constraints>;
  try {
    expected = constraints(ownValue(input, 'constraints', dataError));
  } catch {
    dataError('settlement');
  }

  const matches: DailySettlementInput[] = [];
  for (const candidate of settlements) {
    assertPlainRecord(candidate, 'settlement', dataError);
    const effectiveAt = instant(
      ownValue(candidate, 'effectiveAt', dataError),
      'settlement',
      dataError,
    );
    if (compare(effectiveAt, requiredEffectiveAt) === 0) {
      const observedAt = instant(
        ownValue(candidate, 'observedAt', dataError),
        'settlement',
        dataError,
      );
      if (compare(observedAt, decisionAt) > 0) continue;
      const contractId = ownValue(candidate, 'contractId', dataError);
      if (contractId !== expected.contractId) continue;
      matches.push({
        effectiveAt,
        version: ownValue(candidate, 'version', dataError) as string,
        source: ownValue(candidate, 'source', dataError) as string,
        observedAt,
        contractId,
        currency: ownValue(candidate, 'currency', dataError) as string,
        price: ownValue(candidate, 'price', dataError) as string,
      });
    }
  }
  if (matches.length !== 1) dataError('settlement', { count: matches.length });
  const match = matches[0] as DailySettlementInput;
  let selected: Readonly<DailySettlement>;
  try {
    selected = createDailySettlement(match, expected);
  } catch {
    dataError('settlement');
  }
  return selected;
}

function signedOutput(
  value: InstanceType<typeof ExecutionDecimal>,
  field: string,
) {
  return signedExecutionDecimal(value.toFixed(), field);
}

export function applyDailySettlement(
  input: ApplyDailySettlementInput,
): Readonly<DailySettlementApplied> {
  assertPlainRecord(input, 'input');
  const current = snapshotOpenPosition(
    ownValue(input, 'position'),
    'position.limitations',
  );
  const decisionAt = instant(ownValue(input, 'decisionAt'), 'decisionAt');
  const settlementCurrency = currency(ownValue(input, 'currency'), 'currency');
  const monetaryValue = positiveExecutionDecimal(
    ownValue(input, 'monetaryValuePerPriceUnit'),
    'monetaryValuePerPriceUnit',
  );
  const cashBefore = signedExecutionDecimal(ownValue(input, 'cash'), 'cash');
  const realizedEquityBefore = signedExecutionDecimal(
    ownValue(input, 'realizedEquity'),
    'realizedEquity',
  );
  let settlement: Readonly<DailySettlement>;
  try {
    settlement = createDailySettlement(
      ownValue(input, 'settlement') as DailySettlementInput,
      {
        contractId: current.contractId,
        currency: settlementCurrency,
        tickSize: current.tickSize,
      },
    );
  } catch (error) {
    if (
      error instanceof ExecutionInputError &&
      error.details?.field === 'contractId'
    ) {
      invalid('contractId');
    }
    throw error;
  }

  if (compare(settlement.observedAt, decisionAt) > 0) {
    dataError('settlement', {
      observedAt: settlement.observedAt,
      decisionAt,
    });
  }
  if (compare(settlement.effectiveAt, current.openedAt) <= 0) {
    invalid('effectiveAt', settlement.effectiveAt);
  }
  if (
    current.lastSettlementEffectiveAt !== null &&
    compare(settlement.effectiveAt, current.lastSettlementEffectiveAt) <= 0
  ) {
    invalid('effectiveAt', settlement.effectiveAt);
  }

  const basis = new ExecutionDecimal(current.accountingBasisPrice);
  const settled = new ExecutionDecimal(settlement.price);
  const quantity = new ExecutionDecimal(current.quantity);
  const perUnit = new ExecutionDecimal(monetaryValue);
  const priceChange =
    current.direction === 'LONG' ? settled.minus(basis) : basis.minus(settled);
  const variation = priceChange.times(perUnit).times(quantity);
  const variationMargin = signedOutput(variation, 'variationMargin');
  const cashAfter = signedOutput(
    new ExecutionDecimal(cashBefore).plus(variation),
    'cashAfter',
  );
  const realizedEquityAfter = signedOutput(
    new ExecutionDecimal(realizedEquityBefore).plus(variation),
    'realizedEquityAfter',
  );
  const updatedPosition = Object.freeze({
    ...current,
    accountingBasisPrice: settlement.price,
    lastSettlementEffectiveAt: settlement.effectiveAt,
  });

  return Object.freeze({
    type: 'DAILY_SETTLEMENT_APPLIED',
    positionId: current.positionId,
    contractId: current.contractId,
    effectiveAt: settlement.effectiveAt,
    availableAt: settlement.observedAt,
    currency: settlement.currency,
    previousAccountingBasisPrice: current.accountingBasisPrice,
    settlementPrice: settlement.price,
    variationMargin,
    cashBefore,
    cashAfter,
    realizedEquityBefore,
    realizedEquityAfter,
    position: updatedPosition,
    limitations: executionLimitations,
  });
}
