import { Temporal } from '@js-temporal/polyfill';
import {
  asCurrencyCode,
  asDecimalString,
  asInstantString,
  type CurrencyCode,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';

import { isRiskDecimalWithinBounds, riskDecimalFrom } from './decimal.js';
import { RiskInputError } from './errors.js';

export interface RiskPolicyInput {
  version: string;
  approvalStatus: string;
  referenceCurrency: string;
  accountCurrency: string;
  initialCapital: string;
  maxSizingCapital: string;
  riskPerTradePct: string;
  maxOpenRiskPct: string;
  maxOpenPositions: number;
  maxContractsPerPosition: string;
  maxGrossExposurePct: string;
  maxMarginUsagePct: string;
  cashReservePct: string;
  dailyLossLimitPct: string;
  maxDrawdownPct: string;
  riskGroupMaxExposurePct: Readonly<Record<string, string>>;
  allowCashInjection: boolean;
  sizingEquityMode: string;
  capIncreaseMode: string;
  approvedBy: string;
  approvedAt: string;
  activatedAt: string;
}

export interface RiskPolicyVersion {
  readonly version: string;
  readonly approvalStatus: 'APPROVED';
  readonly referenceCurrency: CurrencyCode;
  readonly accountCurrency: CurrencyCode;
  readonly initialCapital: DecimalString;
  readonly maxSizingCapital: DecimalString;
  readonly riskPerTradePct: DecimalString;
  readonly maxOpenRiskPct: DecimalString;
  readonly maxOpenPositions: number;
  readonly maxContractsPerPosition: DecimalString;
  readonly maxGrossExposurePct: DecimalString;
  readonly maxMarginUsagePct: DecimalString;
  readonly cashReservePct: DecimalString;
  readonly dailyLossLimitPct: DecimalString;
  readonly maxDrawdownPct: DecimalString;
  readonly riskGroupMaxExposurePct: Readonly<Record<string, DecimalString>>;
  readonly allowCashInjection: false;
  readonly sizingEquityMode: 'REALIZED_PLUS_UNREALIZED_LOSSES';
  readonly capIncreaseMode: 'MANUAL_VERSIONED';
  readonly approvedBy: string;
  readonly approvedAt: InstantString;
  readonly activatedAt: InstantString;
}

type JsonMirrorNumber = string | number;

export interface RiskPolicyDenormalizationInput {
  riskPolicyVersion: string;
  referenceCurrency?: string;
  accountCurrency?: string;
  initialCapital?: JsonMirrorNumber;
  maxSizingCapital?: JsonMirrorNumber;
  riskPerTradePct?: JsonMirrorNumber;
  maxOpenRiskPct?: JsonMirrorNumber;
  maxOpenPositions?: JsonMirrorNumber;
  maxContractsPerPosition?: JsonMirrorNumber;
  maxGrossExposurePct?: JsonMirrorNumber;
  maxMarginUsagePct?: JsonMirrorNumber;
  cashReservePct?: JsonMirrorNumber;
  dailyLossLimitPct?: JsonMirrorNumber;
  maxDrawdownPct?: JsonMirrorNumber;
  riskGroupMaxExposurePct?: Readonly<Record<string, JsonMirrorNumber>>;
  allowCashInjection?: boolean;
  sizingEquityMode?: string;
  capIncreaseMode?: string;
}

export interface M2ARiskSafetyAssertionsInput {
  futuresEligibility: string;
  requireExplicitGrossExposureLimit: boolean;
  includeEstimatedExitCosts: boolean;
  rejectIfMinQuantityExceedsRiskBudget: boolean;
}

export interface M2ARiskSafetyAssertions {
  readonly futuresEligibility: 'RESEARCH_ONLY';
  readonly requireExplicitGrossExposureLimit: true;
  readonly includeEstimatedExitCosts: true;
  readonly rejectIfMinQuantityExceedsRiskBudget: true;
}

const MAX_RISK_GROUPS = 256;

function fail(message: string, field: string, value?: unknown): never {
  throw new RiskInputError('INVALID_RISK_INPUT', message, { field, value });
}

function assertPlainObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(`${field} must be a plain object.`, field);
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${field} must be a plain object.`, field);
    }
  } catch (error) {
    if (error instanceof RiskInputError) throw error;
    fail(`${field} must be a readable plain object.`, field);
  }
}

function property(input: Record<string, unknown>, field: string): unknown {
  try {
    return input[field];
  } catch {
    fail(`${field} must be readable.`, field);
  }
}

function requiredProperty(
  input: Record<string, unknown>,
  propertyName: string,
  field = propertyName,
): unknown {
  try {
    if (!Object.hasOwn(input, propertyName)) {
      fail(`${field} must be an own property.`, field);
    }
  } catch (error) {
    if (error instanceof RiskInputError) throw error;
    fail(`${field} must be readable.`, field);
  }
  return property(input, propertyName);
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${field} must be a nonblank string.`, field, value);
  }
  return value;
}

function exactString<T extends string>(
  value: unknown,
  expected: T,
  field: string,
): T {
  if (value !== expected) {
    fail(`${field} must equal ${expected}.`, field, value);
  }
  return expected;
}

function exactBoolean<T extends boolean>(
  value: unknown,
  expected: T,
  field: string,
): T {
  if (value !== expected) {
    fail(`${field} must equal ${String(expected)}.`, field, value);
  }
  return expected;
}

function decimal(value: unknown, field: string): DecimalString {
  if (typeof value !== 'string' || !isRiskDecimalWithinBounds(value)) {
    fail(`${field} must be a bounded canonical decimal string.`, field, value);
  }
  try {
    return asDecimalString(value);
  } catch {
    fail(`${field} must be a bounded canonical decimal string.`, field, value);
  }
}

function nonnegativeDecimal(
  value: unknown,
  field: string,
  boundedAt100 = false,
): DecimalString {
  const result = decimal(value, field);
  if (
    result.startsWith('-') ||
    (boundedAt100 && riskDecimalFrom(result).gt(100))
  ) {
    fail(`${field} is outside its allowed range.`, field, value);
  }
  return result;
}

function positiveDecimal(value: unknown, field: string): DecimalString {
  const result = decimal(value, field);
  if (result.startsWith('-') || riskDecimalFrom(result).lte(0)) {
    fail(`${field} must be greater than zero.`, field, value);
  }
  return result;
}

function positiveIntegerDecimal(value: unknown, field: string): DecimalString {
  const result = positiveDecimal(value, field);
  if (!riskDecimalFrom(result).isInteger()) {
    fail(`${field} must be a positive integer decimal.`, field, value);
  }
  return result;
}

function canonicalInstant(value: unknown, field: string): InstantString {
  if (typeof value !== 'string') {
    fail(`${field} must be a canonical instant.`, field, value);
  }
  try {
    const result = asInstantString(value);
    if (result !== value) {
      fail(`${field} must be a canonical instant.`, field, value);
    }
    return result;
  } catch (error) {
    if (error instanceof RiskInputError) throw error;
    fail(`${field} must be a canonical instant.`, field, value);
  }
}

function eur(value: unknown, field: string): CurrencyCode {
  if (value !== 'EUR') {
    fail(`${field} must be EUR.`, field, value);
  }
  return asCurrencyCode('EUR');
}

function ownEnumerableKeys(
  input: Record<string, unknown>,
  field: string,
): string[] {
  try {
    const keys = Object.keys(input);
    if (keys.length > MAX_RISK_GROUPS) {
      fail(`${field} exceeds its supported size.`, field);
    }
    return keys;
  } catch (error) {
    if (error instanceof RiskInputError) throw error;
    fail(`${field} must be readable.`, field);
  }
}

function riskGroups(
  value: unknown,
  field: string,
): Readonly<Record<string, DecimalString>> {
  assertPlainObject(value, field);
  const keys = ownEnumerableKeys(value, field);
  if (keys.length === 0) fail(`${field} must not be empty.`, field);

  const result: Record<string, DecimalString> = {};
  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (key.length === 0 || Object.hasOwn(result, key)) {
      fail(`${field} has a blank or duplicate normalized key.`, field, rawKey);
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: nonnegativeDecimal(
        property(value, rawKey),
        `${field}.${rawKey}`,
        true,
      ),
      writable: true,
    });
  }
  return Object.freeze(result);
}

const policyFields = [
  'version',
  'approvalStatus',
  'referenceCurrency',
  'accountCurrency',
  'initialCapital',
  'maxSizingCapital',
  'riskPerTradePct',
  'maxOpenRiskPct',
  'maxOpenPositions',
  'maxContractsPerPosition',
  'maxGrossExposurePct',
  'maxMarginUsagePct',
  'cashReservePct',
  'dailyLossLimitPct',
  'maxDrawdownPct',
  'riskGroupMaxExposurePct',
  'allowCashInjection',
  'sizingEquityMode',
  'capIncreaseMode',
  'approvedBy',
  'approvedAt',
  'activatedAt',
] as const;

export function createRiskPolicy(input: RiskPolicyInput): RiskPolicyVersion {
  assertPlainObject(input, 'input');
  const raw = Object.fromEntries(
    policyFields.map((field) => [field, requiredProperty(input, field)]),
  ) as Record<(typeof policyFields)[number], unknown>;

  const version = nonBlank(raw.version, 'version');
  const approvedBy = nonBlank(raw.approvedBy, 'approvedBy');
  const approvedAt = canonicalInstant(raw.approvedAt, 'approvedAt');
  const activatedAt = canonicalInstant(raw.activatedAt, 'activatedAt');
  if (Temporal.Instant.compare(approvedAt, activatedAt) > 0) {
    fail(
      'activatedAt must not precede approvedAt.',
      'activatedAt',
      activatedAt,
    );
  }
  if (
    !Number.isSafeInteger(raw.maxOpenPositions) ||
    (raw.maxOpenPositions as number) <= 0
  ) {
    fail(
      'maxOpenPositions must be a positive safe integer.',
      'maxOpenPositions',
      raw.maxOpenPositions,
    );
  }
  const initialCapital = decimal(raw.initialCapital, 'initialCapital');
  if (initialCapital !== '1000') {
    fail(
      'initialCapital must equal the exact baseline string 1000.',
      'initialCapital',
      raw.initialCapital,
    );
  }

  return Object.freeze({
    version,
    approvalStatus: exactString(
      raw.approvalStatus,
      'APPROVED',
      'approvalStatus',
    ),
    referenceCurrency: eur(raw.referenceCurrency, 'referenceCurrency'),
    accountCurrency: eur(raw.accountCurrency, 'accountCurrency'),
    initialCapital,
    maxSizingCapital: positiveDecimal(raw.maxSizingCapital, 'maxSizingCapital'),
    riskPerTradePct: nonnegativeDecimal(
      raw.riskPerTradePct,
      'riskPerTradePct',
      true,
    ),
    maxOpenRiskPct: nonnegativeDecimal(
      raw.maxOpenRiskPct,
      'maxOpenRiskPct',
      true,
    ),
    maxOpenPositions: raw.maxOpenPositions as number,
    maxContractsPerPosition: positiveIntegerDecimal(
      raw.maxContractsPerPosition,
      'maxContractsPerPosition',
    ),
    maxGrossExposurePct: positiveDecimal(
      raw.maxGrossExposurePct,
      'maxGrossExposurePct',
    ),
    maxMarginUsagePct: nonnegativeDecimal(
      raw.maxMarginUsagePct,
      'maxMarginUsagePct',
      true,
    ),
    cashReservePct: nonnegativeDecimal(
      raw.cashReservePct,
      'cashReservePct',
      true,
    ),
    dailyLossLimitPct: nonnegativeDecimal(
      raw.dailyLossLimitPct,
      'dailyLossLimitPct',
      true,
    ),
    maxDrawdownPct: nonnegativeDecimal(
      raw.maxDrawdownPct,
      'maxDrawdownPct',
      true,
    ),
    riskGroupMaxExposurePct: riskGroups(
      raw.riskGroupMaxExposurePct,
      'riskGroupMaxExposurePct',
    ),
    allowCashInjection: exactBoolean(
      raw.allowCashInjection,
      false,
      'allowCashInjection',
    ),
    sizingEquityMode: exactString(
      raw.sizingEquityMode,
      'REALIZED_PLUS_UNREALIZED_LOSSES',
      'sizingEquityMode',
    ),
    capIncreaseMode: exactString(
      raw.capIncreaseMode,
      'MANUAL_VERSIONED',
      'capIncreaseMode',
    ),
    approvedBy,
    approvedAt,
    activatedAt,
  });
}

const mirrorFields = [
  'riskPolicyVersion',
  'referenceCurrency',
  'accountCurrency',
  'initialCapital',
  'maxSizingCapital',
  'allowCashInjection',
  'sizingEquityMode',
  'capIncreaseMode',
  'riskPerTradePct',
  'maxOpenRiskPct',
  'maxOpenPositions',
  'maxContractsPerPosition',
  'maxGrossExposurePct',
  'maxMarginUsagePct',
  'cashReservePct',
  'dailyLossLimitPct',
  'maxDrawdownPct',
  'riskGroupMaxExposurePct',
] as const;

const absentMirror = Symbol('absentMirror');

function optionalMirrorProperty(
  input: Record<string, unknown>,
  field: string,
): unknown {
  try {
    if (!Object.hasOwn(input, field)) return absentMirror;
  } catch {
    fail(`${field} must be readable.`, field);
  }
  return property(input, field);
}

function jsonNumber(value: unknown, field: string): DecimalString {
  if (typeof value === 'string') return decimal(value, field);
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    fail(
      `${field} must be an unambiguous finite JSON number or decimal string.`,
      field,
      value,
    );
  }
  const rendered = value.toString();
  if (rendered.includes('e') || rendered.includes('E')) {
    fail(`${field} must not use exponent notation.`, field, value);
  }
  return decimal(rendered, field);
}

function mismatch(field: string, expected: unknown, actual: unknown): never {
  throw new RiskInputError(
    'INVALID_RISK_INPUT',
    `${field} does not match the resolved risk policy.`,
    {
      field,
      expected,
      actual,
    },
  );
}

function assertDecimalMirror(
  field: string,
  actual: unknown,
  expected: DecimalString,
): void {
  const canonical = jsonNumber(actual, field);
  if (!riskDecimalFrom(canonical).eq(riskDecimalFrom(expected))) {
    mismatch(field, expected, canonical);
  }
}

function assertRiskGroupMirror(
  actual: unknown,
  expected: Readonly<Record<string, DecimalString>>,
): void {
  const field = 'riskGroupMaxExposurePct';
  assertPlainObject(actual, field);
  const keys = ownEnumerableKeys(actual, field);
  const expectedKeys = Object.keys(expected);
  if (keys.length !== expectedKeys.length) mismatch(field, expected, actual);
  const seen = new Set<string>();
  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (key.length === 0 || seen.has(key) || !Object.hasOwn(expected, key)) {
      mismatch(field, expected, actual);
    }
    seen.add(key);
    const expectedValue = expected[key] as DecimalString;
    assertDecimalMirror(field, property(actual, rawKey), expectedValue);
  }
}

export function assertRiskPolicyDenormalizationMatches(
  policy: Readonly<RiskPolicyVersion>,
  input: RiskPolicyDenormalizationInput,
): void {
  const resolved = createRiskPolicy(policy);
  assertPlainObject(input, 'input');
  const raw = Object.fromEntries(
    mirrorFields.map((field) => [
      field,
      field === 'riskPolicyVersion'
        ? requiredProperty(input, field)
        : optionalMirrorProperty(input, field),
    ]),
  ) as Record<(typeof mirrorFields)[number], unknown>;

  if (raw.riskPolicyVersion !== resolved.version) {
    mismatch('riskPolicyVersion', resolved.version, raw.riskPolicyVersion);
  }

  const exactMirrors = {
    referenceCurrency: resolved.referenceCurrency,
    accountCurrency: resolved.accountCurrency,
    allowCashInjection: resolved.allowCashInjection,
    sizingEquityMode: resolved.sizingEquityMode,
    capIncreaseMode: resolved.capIncreaseMode,
  } as const;
  for (const [field, expected] of Object.entries(exactMirrors)) {
    if (
      raw[field as keyof typeof raw] !== absentMirror &&
      raw[field as keyof typeof raw] !== expected
    ) {
      mismatch(field, expected, raw[field as keyof typeof raw]);
    }
  }

  const decimalMirrors = {
    initialCapital: resolved.initialCapital,
    maxSizingCapital: resolved.maxSizingCapital,
    riskPerTradePct: resolved.riskPerTradePct,
    maxOpenRiskPct: resolved.maxOpenRiskPct,
    maxOpenPositions: asDecimalString(resolved.maxOpenPositions.toString()),
    maxContractsPerPosition: resolved.maxContractsPerPosition,
    maxGrossExposurePct: resolved.maxGrossExposurePct,
    maxMarginUsagePct: resolved.maxMarginUsagePct,
    cashReservePct: resolved.cashReservePct,
    dailyLossLimitPct: resolved.dailyLossLimitPct,
    maxDrawdownPct: resolved.maxDrawdownPct,
  } as const;
  for (const [field, expected] of Object.entries(decimalMirrors)) {
    const actual = raw[field as keyof typeof raw];
    if (actual !== absentMirror) assertDecimalMirror(field, actual, expected);
  }

  if (raw.riskGroupMaxExposurePct !== absentMirror) {
    assertRiskGroupMirror(
      raw.riskGroupMaxExposurePct,
      resolved.riskGroupMaxExposurePct,
    );
  }
}

export function assertM2ARiskSafetyAssertions(
  input: M2ARiskSafetyAssertionsInput,
): M2ARiskSafetyAssertions {
  assertPlainObject(input, 'input');
  const raw = {
    futuresEligibility: requiredProperty(input, 'futuresEligibility'),
    requireExplicitGrossExposureLimit: requiredProperty(
      input,
      'requireExplicitGrossExposureLimit',
    ),
    includeEstimatedExitCosts: requiredProperty(
      input,
      'includeEstimatedExitCosts',
    ),
    rejectIfMinQuantityExceedsRiskBudget: requiredProperty(
      input,
      'rejectIfMinQuantityExceedsRiskBudget',
    ),
  };
  return Object.freeze({
    futuresEligibility: exactString(
      raw.futuresEligibility,
      'RESEARCH_ONLY',
      'futuresEligibility',
    ),
    requireExplicitGrossExposureLimit: exactBoolean(
      raw.requireExplicitGrossExposureLimit,
      true,
      'requireExplicitGrossExposureLimit',
    ),
    includeEstimatedExitCosts: exactBoolean(
      raw.includeEstimatedExitCosts,
      true,
      'includeEstimatedExitCosts',
    ),
    rejectIfMinQuantityExceedsRiskBudget: exactBoolean(
      raw.rejectIfMinQuantityExceedsRiskBudget,
      true,
      'rejectIfMinQuantityExceedsRiskBudget',
    ),
  });
}
