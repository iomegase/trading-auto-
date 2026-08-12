import { Temporal } from '@js-temporal/polyfill';
import {
  asDecimalString,
  asInstantString,
  createFuturesContract,
  createFuturesProduct,
  type DecimalString,
  type FuturesContract,
  type FuturesContractInput,
  type FuturesProduct,
  type FuturesProductInput,
  type InstantString,
} from '@trading-auto/domain';

import {
  calculateCandidateEconomics,
  type CandidateEconomics,
} from './economics.js';
import { calculateSizingEquity } from './equity.js';
import {
  isRiskDecimalWithinBounds,
  riskDecimalFrom,
  riskDecimalToString,
} from './decimal.js';
import { RiskInputError, type RiskInputErrorCode } from './errors.js';
import {
  assertM2ARiskSafetyAssertions,
  createRiskPolicy,
  type M2ARiskSafetyAssertions,
  type RiskPolicyVersion,
} from './policy.js';
import {
  createRiskAccountState,
  createRiskPortfolioState,
  type RiskAccountState,
  type RiskPortfolioState,
} from './portfolio.js';
import {
  createCostModelSnapshot,
  createEligibilitySnapshot,
  createFxSnapshot,
  createMarginSnapshot,
  type CostModelSnapshot,
  type CostModelSnapshotInput,
  type EligibilitySnapshot,
  type EligibilitySnapshotInput,
  type FeeScheduleInput,
  type FxSnapshot,
  type FxSnapshotInput,
  type MarginSnapshot,
  type MarginSnapshotInput,
  type RiskSnapshotBundle,
} from './snapshots.js';

export type RiskPolicyUseMode = 'HISTORICAL_RESEARCH' | 'FORWARD';

export interface OrderRiskInput {
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly requestedQuantity?: DecimalString;
  readonly decisionAt: InstantString;
  readonly riskPolicyUseMode: RiskPolicyUseMode;
  readonly riskPolicyUseAt: InstantString;
  readonly backtestId?: string;
  readonly runCreatedAt?: InstantString;
  readonly signalExpiresAt: InstantString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
  readonly product: Readonly<FuturesProduct>;
  readonly contract: Readonly<FuturesContract>;
  readonly snapshots: Readonly<RiskSnapshotBundle>;
  readonly policy: Readonly<RiskPolicyVersion>;
  readonly safetyAssertions: Readonly<M2ARiskSafetyAssertions>;
  readonly account: Readonly<RiskAccountState>;
  readonly portfolio: Readonly<RiskPortfolioState>;
}

export type RiskDecisionReason =
  | 'KILL_SWITCH'
  | 'SIGNAL_EXPIRED'
  | 'POSITION_ALREADY_ACTIVE'
  | 'ENTRY_INTENT_ALREADY_ACTIVE'
  | 'MAX_POSITIONS'
  | 'MAX_CONTRACTS_PER_POSITION'
  | 'DAILY_LOSS_LIMIT'
  | 'DRAWDOWN_LIMIT'
  | 'NO_SIZING_EQUITY'
  | 'MISSING_FX'
  | 'STALE_FX'
  | 'MISSING_MARGIN'
  | 'STALE_MARGIN'
  | 'MISSING_ELIGIBILITY'
  | 'STALE_ELIGIBILITY'
  | 'INELIGIBLE_CONTRACT'
  | 'RISK_BUDGET'
  | 'OPEN_RISK'
  | 'MARGIN'
  | 'GROSS_EXPOSURE'
  | 'RISK_GROUP_EXPOSURE'
  | 'AVAILABLE_FUNDS'
  | 'MIN_QUANTITY';

export interface RiskDecisionContext {
  readonly decisionAt: InstantString;
  readonly riskPolicyUseMode: RiskPolicyUseMode;
  readonly riskPolicyUseAt: InstantString;
  readonly backtestId: string | null;
  readonly runCreatedAt: InstantString | null;
  readonly signalExpiresAt: InstantString;
  readonly entryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
  readonly riskPolicyVersion: string;
  readonly fxVersion: string | null;
  readonly marginVersion: string | null;
  readonly costModelVersion: string;
  readonly eligibilityVersion: string | null;
  readonly productCode: string;
  readonly contractId: string;
}

export type RiskDecision =
  | Readonly<{
      status: 'APPROVE';
      quantity: DecimalString;
      reasons: readonly [];
      economics: Readonly<CandidateEconomics>;
      context: Readonly<RiskDecisionContext>;
    }>
  | Readonly<{
      status: 'REDUCE_SIZE';
      requestedQuantity: DecimalString;
      quantity: DecimalString;
      reasons: readonly RiskDecisionReason[];
      economics: Readonly<CandidateEconomics>;
      context: Readonly<RiskDecisionContext>;
    }>
  | Readonly<{
      status: 'REJECT';
      quantity: DecimalString;
      reasons: readonly RiskDecisionReason[];
      economics: Readonly<CandidateEconomics> | null;
      context: Readonly<RiskDecisionContext>;
    }>;

const MAX_GRID_ITERATIONS = 10_000;
const MAX_FEE_TIERS = 256;
const MAX_RISK_GROUPS = 256;
const MAX_PORTFOLIO_ITEMS = 1_000;
const CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const absent = Symbol('absent');
const noReasons: readonly [] = Object.freeze([]);

const reasonOrder: readonly RiskDecisionReason[] = Object.freeze([
  'KILL_SWITCH',
  'SIGNAL_EXPIRED',
  'POSITION_ALREADY_ACTIVE',
  'ENTRY_INTENT_ALREADY_ACTIVE',
  'MAX_POSITIONS',
  'MAX_CONTRACTS_PER_POSITION',
  'DAILY_LOSS_LIMIT',
  'DRAWDOWN_LIMIT',
  'NO_SIZING_EQUITY',
  'MISSING_FX',
  'STALE_FX',
  'MISSING_MARGIN',
  'STALE_MARGIN',
  'MISSING_ELIGIBILITY',
  'STALE_ELIGIBILITY',
  'INELIGIBLE_CONTRACT',
  'RISK_BUDGET',
  'OPEN_RISK',
  'MARGIN',
  'GROSS_EXPOSURE',
  'RISK_GROUP_EXPOSURE',
  'AVAILABLE_FUNDS',
  'MIN_QUANTITY',
]);

type ObjectRecord = Record<string, unknown>;

function fail(
  code: RiskInputErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new RiskInputError(code, message, details);
}

function invalid(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  fail('INVALID_RISK_INPUT', message, details);
}

function assertPlainRecord(
  value: unknown,
  field: string,
  code: RiskInputErrorCode = 'INVALID_RISK_INPUT',
): asserts value is ObjectRecord {
  if (typeof value !== 'object' || value === null) {
    fail(code, `${field} must be a plain object.`, { field });
  }
  let isArray: boolean;
  let prototype: object | null;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    fail(code, `${field} must be a readable plain object.`, { field });
  }
  if (isArray || (prototype !== Object.prototype && prototype !== null)) {
    fail(code, `${field} must be a plain object.`, { field });
  }
}

function descriptorValue(
  input: object,
  descriptor: PropertyDescriptor,
  field: string,
  code: RiskInputErrorCode,
): unknown {
  if ('value' in descriptor) return descriptor.value;
  if (descriptor.get === undefined) return undefined;
  try {
    return descriptor.get.call(input);
  } catch {
    fail(code, `${field} must be readable.`, { field });
  }
}

function ownValue(
  input: object,
  property: string,
  field: string,
  code: RiskInputErrorCode = 'INVALID_RISK_INPUT',
  optional = false,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, property);
  } catch {
    fail(code, `${field} must be an own readable property.`, { field });
  }
  if (descriptor === undefined) {
    if (optional) return absent;
    fail(code, `${field} must be an own property.`, { field });
  }
  return descriptorValue(input, descriptor, field, code);
}

function boundedSnapshotDecimal(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !isRiskDecimalWithinBounds(value) ||
    !CANONICAL_DECIMAL.test(value)
  ) {
    fail(
      'INVALID_SNAPSHOT',
      `${field} must be a bounded canonical decimal string.`,
      { field },
    );
  }
  return value;
}

function captureRecord(
  value: unknown,
  fields: readonly string[],
  field: string,
  code: RiskInputErrorCode = 'INVALID_RISK_INPUT',
): ObjectRecord {
  assertPlainRecord(value, field, code);
  const captured: ObjectRecord = {};
  for (const property of fields) {
    Object.defineProperty(captured, property, {
      configurable: true,
      enumerable: true,
      value: ownValue(value, property, `${field}.${property}`, code),
      writable: true,
    });
  }
  return captured;
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${field} must be a nonblank string.`, { field, value });
  }
  return value;
}

function canonicalDecimal(value: unknown, field: string): DecimalString {
  if (typeof value !== 'string' || !isRiskDecimalWithinBounds(value)) {
    invalid(`${field} must be a bounded canonical decimal string.`, {
      field,
      value,
    });
  }
  try {
    return asDecimalString(value);
  } catch {
    invalid(`${field} must be a bounded canonical decimal string.`, {
      field,
      value,
    });
  }
}

function positiveDecimal(value: unknown, field: string): DecimalString {
  const result = canonicalDecimal(value, field);
  if (riskDecimalFrom(result).lte(0)) {
    invalid(`${field} must be greater than zero.`, { field, value });
  }
  return result;
}

function canonicalInstant(value: unknown, field: string): InstantString {
  if (typeof value !== 'string') {
    invalid(`${field} must be a canonical instant.`, { field, value });
  }
  let result: InstantString;
  try {
    result = asInstantString(value);
  } catch {
    invalid(`${field} must be a canonical instant.`, { field, value });
  }
  if (result !== value) {
    invalid(`${field} must be a canonical instant.`, { field, value });
  }
  return result;
}

function validateDomain<T>(factory: () => T, field: string): T {
  try {
    return factory();
  } catch {
    invalid(`${field} is invalid.`, { field });
  }
}

const productFields = [
  'productCode',
  'exchange',
  'underlyingId',
  'quoteCurrency',
  'pnlCurrency',
  'tickSize',
  'tickValue',
  'monetaryValuePerPriceUnit',
  'quantityStep',
  'minQuantity',
  'riskGroup',
] as const;

function validatedProduct(value: unknown): Readonly<FuturesProduct> {
  const captured = captureRecord(value, productFields, 'product');
  return validateDomain(
    () => createFuturesProduct(captured as unknown as FuturesProductInput),
    'product',
  );
}

const contractFields = [
  'contractId',
  'productCode',
  'firstTradeAt',
  'lastTradeAt',
  'expiryAt',
  'settlementType',
] as const;

function validatedContract(
  value: unknown,
  product: Readonly<FuturesProduct>,
): Readonly<FuturesContract> {
  const captured = captureRecord(value, contractFields, 'contract');
  return validateDomain(
    () =>
      createFuturesContract(
        captured as unknown as FuturesContractInput,
        product,
      ),
    'contract',
  );
}

const metadataFields = [
  'version',
  'source',
  'observedAt',
  'validFrom',
  'validUntil',
] as const;

function captureSnapshot(
  value: unknown,
  fields: readonly string[],
  field: string,
): ObjectRecord {
  return captureRecord(
    value,
    [...metadataFields, ...fields],
    field,
    'INVALID_SNAPSHOT',
  );
}

function validatedFx(value: unknown): Readonly<FxSnapshot> {
  const captured = captureSnapshot(
    value,
    ['baseCurrency', 'quoteCurrency', 'rate'],
    'snapshots.fx',
  );
  captured.rate = boundedSnapshotDecimal(captured.rate, 'snapshots.fx.rate');
  return createFxSnapshot(captured as unknown as FxSnapshotInput);
}

function validatedMargin(value: unknown): Readonly<MarginSnapshot> {
  const captured = captureSnapshot(
    value,
    [
      'contractId',
      'currency',
      'initialMarginPerContract',
      'maintenanceMarginPerContract',
    ],
    'snapshots.margin',
  );
  captured.initialMarginPerContract = boundedSnapshotDecimal(
    captured.initialMarginPerContract,
    'snapshots.margin.initialMarginPerContract',
  );
  captured.maintenanceMarginPerContract = boundedSnapshotDecimal(
    captured.maintenanceMarginPerContract,
    'snapshots.margin.maintenanceMarginPerContract',
  );
  return createMarginSnapshot(captured as unknown as MarginSnapshotInput);
}

function validatedEligibility(value: unknown): Readonly<EligibilitySnapshot> {
  const captured = captureSnapshot(
    value,
    ['contractId', 'researchOnly', 'eligible', 'reason'],
    'snapshots.eligibility',
  );
  return createEligibilitySnapshot(
    captured as unknown as EligibilitySnapshotInput,
  );
}

function capturedDenseArray(
  value: unknown,
  field: string,
  limit = MAX_FEE_TIERS,
  code: RiskInputErrorCode = 'INVALID_SNAPSHOT',
): readonly unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail(code, `${field} must be a dense array.`, { field });
  }
  if (!isArray) {
    fail(code, `${field} must be a dense array.`, { field });
  }
  const record = value as object;
  const length = ownValue(record, 'length', `${field}.length`, code);
  if (
    !Number.isSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > limit
  ) {
    fail(code, `${field} has an unsupported length.`, {
      field,
      length,
      limit,
    });
  }
  const result: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    result.push(
      ownValue(record, String(index), `${field}[${String(index)}]`, code),
    );
  }
  return result;
}

function capturedFeeSchedule(value: unknown, field: string): FeeScheduleInput {
  const schedule = captureRecord(
    value,
    ['minimum', 'tiers'],
    field,
    'INVALID_SNAPSHOT',
  );
  const tiers = capturedDenseArray(schedule.tiers, `${field}.tiers`).map(
    (tier, index) => {
      const captured = captureRecord(
        tier,
        ['upToQuantity', 'feePerContract'],
        `${field}.tiers[${String(index)}]`,
        'INVALID_SNAPSHOT',
      );
      return {
        upToQuantity:
          captured.upToQuantity === null
            ? null
            : boundedSnapshotDecimal(
                captured.upToQuantity,
                `${field}.tiers[${String(index)}].upToQuantity`,
              ),
        feePerContract: boundedSnapshotDecimal(
          captured.feePerContract,
          `${field}.tiers[${String(index)}].feePerContract`,
        ),
      };
    },
  );
  return {
    minimum: boundedSnapshotDecimal(schedule.minimum, `${field}.minimum`),
    tiers,
  };
}

function validatedCosts(value: unknown): Readonly<CostModelSnapshot> {
  const captured = captureSnapshot(
    value,
    [
      'contractId',
      'currency',
      'entryFees',
      'exitFees',
      'spreadPriceUnitsRoundTrip',
      'adverseEntrySlippagePriceUnits',
      'adverseExitSlippagePriceUnits',
    ],
    'snapshots.costs',
  );
  const input = {
    ...captured,
    entryFees: capturedFeeSchedule(
      captured.entryFees,
      'snapshots.costs.entryFees',
    ),
    exitFees: capturedFeeSchedule(
      captured.exitFees,
      'snapshots.costs.exitFees',
    ),
    spreadPriceUnitsRoundTrip: boundedSnapshotDecimal(
      captured.spreadPriceUnitsRoundTrip,
      'snapshots.costs.spreadPriceUnitsRoundTrip',
    ),
    adverseEntrySlippagePriceUnits: boundedSnapshotDecimal(
      captured.adverseEntrySlippagePriceUnits,
      'snapshots.costs.adverseEntrySlippagePriceUnits',
    ),
    adverseExitSlippagePriceUnits: boundedSnapshotDecimal(
      captured.adverseExitSlippagePriceUnits,
      'snapshots.costs.adverseExitSlippagePriceUnits',
    ),
  };
  return createCostModelSnapshot(input as unknown as CostModelSnapshotInput);
}

interface ValidatedSnapshots {
  readonly fx: Readonly<FxSnapshot> | null;
  readonly margin: Readonly<MarginSnapshot> | null;
  readonly eligibility: Readonly<EligibilitySnapshot> | null;
  readonly costs: Readonly<CostModelSnapshot> | null;
}

function validatedSnapshots(value: unknown): ValidatedSnapshots {
  const captured = captureRecord(
    value,
    ['fx', 'margin', 'eligibility', 'costs'],
    'snapshots',
  );
  return Object.freeze({
    fx: captured.fx === null ? null : validatedFx(captured.fx),
    margin: captured.margin === null ? null : validatedMargin(captured.margin),
    eligibility:
      captured.eligibility === null
        ? null
        : validatedEligibility(captured.eligibility),
    costs: captured.costs === null ? null : validatedCosts(captured.costs),
  });
}

const inputFields = [
  'instrumentId',
  'direction',
  'entryPrice',
  'stopPrice',
  'decisionAt',
  'riskPolicyUseMode',
  'riskPolicyUseAt',
  'signalExpiresAt',
  'datasetVersion',
  'strategyVersion',
  'product',
  'contract',
  'snapshots',
  'policy',
  'safetyAssertions',
  'account',
  'portfolio',
] as const;

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

const accountFields = [
  'accountCurrency',
  'realizedEquity',
  'unrealizedPnl',
  'availableFunds',
  'usedMargin',
  'grossExposure',
  'openRisk',
  'dailyLoss',
  'drawdownPct',
  'killSwitchActive',
] as const;

const safetyAssertionFields = [
  'futuresEligibility',
  'requireExplicitGrossExposureLimit',
  'includeEstimatedExitCosts',
  'rejectIfMinQuantityExceedsRiskBudget',
] as const;

const positionFields = [
  'positionId',
  'instrumentId',
  'contractId',
  'direction',
  'quantity',
  'remainingOpenRisk',
  'margin',
  'grossExposure',
  'riskGroup',
] as const;

const intentFields = [
  'intentId',
  'instrumentId',
  'contractId',
  'direction',
] as const;

function capturedRiskGroups(value: unknown): ObjectRecord {
  const field = 'policy.riskGroupMaxExposurePct';
  assertPlainRecord(value, field);
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalid(`${field} own keys must be readable.`, { field });
  }
  if (keys.length > MAX_RISK_GROUPS) {
    invalid(`${field} exceeds its supported size.`, { field });
  }
  const captured = Object.create(null) as ObjectRecord;
  for (const key of keys) {
    if (typeof key !== 'string') {
      invalid(`${field} keys must be strings.`, { field });
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      invalid(`${field}.${key} descriptor must be readable.`, { field });
    }
    if (descriptor === undefined) {
      invalid(`${field}.${key} must remain an own property.`, { field });
    }
    if (!descriptor.enumerable) continue;
    Object.defineProperty(captured, key, {
      configurable: true,
      enumerable: true,
      value: descriptorValue(
        value,
        descriptor,
        `${field}.${key}`,
        'INVALID_RISK_INPUT',
      ),
      writable: true,
    });
  }
  return captured;
}

function validatedPolicy(value: unknown): Readonly<RiskPolicyVersion> {
  const captured = captureRecord(value, policyFields, 'policy');
  captured.riskGroupMaxExposurePct = capturedRiskGroups(
    captured.riskGroupMaxExposurePct,
  );
  return createRiskPolicy(captured as never);
}

function validatedAccount(value: unknown): Readonly<RiskAccountState> {
  return createRiskAccountState(
    captureRecord(value, accountFields, 'account') as never,
  );
}

function validatedSafetyAssertions(
  value: unknown,
): Readonly<M2ARiskSafetyAssertions> {
  return assertM2ARiskSafetyAssertions(
    captureRecord(value, safetyAssertionFields, 'safetyAssertions') as never,
  );
}

function capturedPortfolioItems(
  value: unknown,
  field: string,
  fields: readonly string[],
): readonly ObjectRecord[] {
  return capturedDenseArray(
    value,
    field,
    MAX_PORTFOLIO_ITEMS,
    'INVALID_RISK_INPUT',
  ).map((item, index) =>
    captureRecord(
      item,
      fields,
      `${field}[${String(index)}]`,
      'INVALID_RISK_INPUT',
    ),
  );
}

function validatedPortfolio(value: unknown): Readonly<RiskPortfolioState> {
  const captured = captureRecord(
    value,
    ['positions', 'activeEntryIntents'],
    'portfolio',
  );
  return createRiskPortfolioState({
    positions: capturedPortfolioItems(
      captured.positions,
      'portfolio.positions',
      positionFields,
    ) as never,
    activeEntryIntents: capturedPortfolioItems(
      captured.activeEntryIntents,
      'portfolio.activeEntryIntents',
      intentFields,
    ) as never,
  });
}

interface ValidatedInput {
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly requestedQuantity: DecimalString | null;
  readonly decisionAt: InstantString;
  readonly riskPolicyUseMode: RiskPolicyUseMode;
  readonly riskPolicyUseAt: InstantString;
  readonly backtestId: string | null;
  readonly runCreatedAt: InstantString | null;
  readonly signalExpiresAt: InstantString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
  readonly product: Readonly<FuturesProduct>;
  readonly contract: Readonly<FuturesContract>;
  readonly snapshots: ValidatedSnapshots;
  readonly policy: Readonly<RiskPolicyVersion>;
  readonly safetyAssertions: Readonly<M2ARiskSafetyAssertions>;
  readonly account: Readonly<RiskAccountState>;
  readonly portfolio: Readonly<RiskPortfolioState>;
}

function assertPriceSetup(
  direction: 'LONG' | 'SHORT',
  entryPrice: DecimalString,
  stopPrice: DecimalString,
  product: Readonly<FuturesProduct>,
): void {
  const entry = riskDecimalFrom(entryPrice);
  const stop = riskDecimalFrom(stopPrice);
  const tick = riskDecimalFrom(product.tickSize);
  if (!entry.mod(tick).isZero() || !stop.mod(tick).isZero()) {
    invalid('Entry and stop prices must align exactly to product.tickSize.', {
      entryPrice,
      stopPrice,
      tickSize: product.tickSize,
    });
  }
  if (direction === 'LONG' ? stop.gte(entry) : stop.lte(entry)) {
    invalid('The protective stop is invalid for the order direction.', {
      direction,
      entryPrice,
      stopPrice,
    });
  }
}

function validatePolicyUse(input: ValidatedInput): void {
  if (
    Temporal.Instant.compare(input.policy.activatedAt, input.riskPolicyUseAt) >
    0
  ) {
    invalid('The risk policy is not active at riskPolicyUseAt.', {
      activatedAt: input.policy.activatedAt,
      riskPolicyUseAt: input.riskPolicyUseAt,
    });
  }
  if (input.riskPolicyUseMode === 'FORWARD') {
    if (input.riskPolicyUseAt !== input.decisionAt) {
      invalid('FORWARD riskPolicyUseAt must equal decisionAt.');
    }
    if (input.backtestId !== null || input.runCreatedAt !== null) {
      invalid('FORWARD evaluation cannot contain historical linkage.');
    }
    return;
  }
  if (input.backtestId === null) {
    invalid('HISTORICAL_RESEARCH requires a nonblank backtestId.');
  }
  if (input.runCreatedAt === null) {
    invalid('HISTORICAL_RESEARCH requires runCreatedAt.');
  }
  if (input.riskPolicyUseAt !== input.runCreatedAt) {
    invalid('HISTORICAL_RESEARCH riskPolicyUseAt must equal runCreatedAt.');
  }
}

function assertContractActive(input: ValidatedInput): void {
  if (
    Temporal.Instant.compare(input.decisionAt, input.contract.firstTradeAt) <
      0 ||
    Temporal.Instant.compare(input.decisionAt, input.contract.lastTradeAt) >= 0
  ) {
    invalid(
      'decisionAt must be inside the contract active interval [firstTradeAt, lastTradeAt).',
      {
        decisionAt: input.decisionAt,
        firstTradeAt: input.contract.firstTradeAt,
        lastTradeAt: input.contract.lastTradeAt,
      },
    );
  }
}

function validatedInput(value: unknown): ValidatedInput {
  assertPlainRecord(value, 'input');
  const raw = captureRecord(value, inputFields, 'input');
  const rawRequested = ownValue(
    value,
    'requestedQuantity',
    'input.requestedQuantity',
    'INVALID_RISK_INPUT',
    true,
  );
  const rawBacktestId = ownValue(
    value,
    'backtestId',
    'input.backtestId',
    'INVALID_RISK_INPUT',
    true,
  );
  const rawRunCreatedAt = ownValue(
    value,
    'runCreatedAt',
    'input.runCreatedAt',
    'INVALID_RISK_INPUT',
    true,
  );
  if (raw.direction !== 'LONG' && raw.direction !== 'SHORT') {
    invalid('direction must be LONG or SHORT.', { value: raw.direction });
  }
  if (
    raw.riskPolicyUseMode !== 'FORWARD' &&
    raw.riskPolicyUseMode !== 'HISTORICAL_RESEARCH'
  ) {
    invalid('riskPolicyUseMode is invalid.', {
      value: raw.riskPolicyUseMode,
    });
  }
  const product = validatedProduct(raw.product);
  const contract = validatedContract(raw.contract, product);
  const entryPrice = positiveDecimal(raw.entryPrice, 'entryPrice');
  const stopPrice = positiveDecimal(raw.stopPrice, 'stopPrice');
  assertPriceSetup(raw.direction, entryPrice, stopPrice, product);
  const requestedQuantity =
    rawRequested === absent
      ? null
      : positiveDecimal(rawRequested, 'requestedQuantity');
  if (
    requestedQuantity !== null &&
    !riskDecimalFrom(requestedQuantity)
      .mod(riskDecimalFrom(product.quantityStep))
      .isZero()
  ) {
    invalid('requestedQuantity must align to product.quantityStep.', {
      requestedQuantity,
      quantityStep: product.quantityStep,
    });
  }
  const account = validatedAccount(raw.account);
  const policy = validatedPolicy(raw.policy);
  const result: ValidatedInput = Object.freeze({
    instrumentId: nonBlank(raw.instrumentId, 'instrumentId'),
    direction: raw.direction,
    entryPrice,
    stopPrice,
    requestedQuantity,
    decisionAt: canonicalInstant(raw.decisionAt, 'decisionAt'),
    riskPolicyUseMode: raw.riskPolicyUseMode,
    riskPolicyUseAt: canonicalInstant(raw.riskPolicyUseAt, 'riskPolicyUseAt'),
    backtestId:
      rawBacktestId === absent ? null : nonBlank(rawBacktestId, 'backtestId'),
    runCreatedAt:
      rawRunCreatedAt === absent
        ? null
        : canonicalInstant(rawRunCreatedAt, 'runCreatedAt'),
    signalExpiresAt: canonicalInstant(raw.signalExpiresAt, 'signalExpiresAt'),
    datasetVersion: nonBlank(raw.datasetVersion, 'datasetVersion'),
    strategyVersion: nonBlank(raw.strategyVersion, 'strategyVersion'),
    product,
    contract,
    snapshots: validatedSnapshots(raw.snapshots),
    policy,
    safetyAssertions: validatedSafetyAssertions(raw.safetyAssertions),
    account,
    portfolio: validatedPortfolio(raw.portfolio),
  });
  assertContractActive(result);
  validatePolicyUse(result);
  return result;
}

function compareInstant(left: InstantString, right: InstantString): number {
  return Temporal.Instant.compare(left, right);
}

function isCurrent(
  snapshot: Readonly<{
    validFrom: InstantString;
    validUntil: InstantString;
  }>,
  decisionAt: InstantString,
): boolean {
  return (
    compareInstant(snapshot.validFrom, decisionAt) <= 0 &&
    compareInstant(decisionAt, snapshot.validUntil) < 0
  );
}

interface CostCoveredInput extends ValidatedInput {
  readonly snapshots: ValidatedSnapshots & {
    readonly costs: Readonly<CostModelSnapshot>;
  };
}

function assertSnapshotConsistency(
  input: ValidatedInput,
): asserts input is CostCoveredInput {
  const { snapshots, product, contract, decisionAt } = input;
  for (const snapshot of [
    snapshots.fx,
    snapshots.margin,
    snapshots.eligibility,
    snapshots.costs,
  ]) {
    if (
      snapshot !== null &&
      compareInstant(snapshot.observedAt, decisionAt) > 0
    ) {
      fail('LOOKAHEAD_SNAPSHOT', 'Snapshot observedAt is after decisionAt.', {
        observedAt: snapshot.observedAt,
        decisionAt,
      });
    }
  }
  for (const snapshot of [
    snapshots.margin,
    snapshots.eligibility,
    snapshots.costs,
  ]) {
    if (snapshot !== null && snapshot.contractId !== contract.contractId) {
      fail('MISMATCHED_CONTRACT', 'Snapshot targets a different contract.', {
        expected: contract.contractId,
        actual: snapshot.contractId,
      });
    }
  }
  for (const snapshot of [snapshots.margin, snapshots.costs]) {
    if (snapshot !== null && snapshot.currency !== product.pnlCurrency) {
      fail(
        'MISMATCHED_CURRENCY',
        'Margin and cost currency must equal the product P&L currency.',
        { expected: product.pnlCurrency, actual: snapshot.currency },
      );
    }
  }
  if (product.pnlCurrency === input.account.accountCurrency) {
    if (snapshots.fx !== null) {
      fail(
        'MISMATCHED_CURRENCY',
        'Identity FX conversion requires a null snapshot.',
      );
    }
  } else if (
    snapshots.fx !== null &&
    !(
      (snapshots.fx.baseCurrency === product.pnlCurrency &&
        snapshots.fx.quoteCurrency === input.account.accountCurrency) ||
      (snapshots.fx.quoteCurrency === product.pnlCurrency &&
        snapshots.fx.baseCurrency === input.account.accountCurrency)
    )
  ) {
    fail('MISMATCHED_CURRENCY', 'FX snapshot has an unrelated pair.');
  }
  if (snapshots.costs === null || !isCurrent(snapshots.costs, decisionAt)) {
    fail(
      'STALE_COST_MODEL',
      'Current cost-model coverage is required for risk evaluation.',
    );
  }
}

function orderedReasons(
  reasons: ReadonlySet<RiskDecisionReason>,
): readonly RiskDecisionReason[] {
  return Object.freeze(reasonOrder.filter((reason) => reasons.has(reason)));
}

function buildContext(input: CostCoveredInput): Readonly<RiskDecisionContext> {
  return Object.freeze({
    decisionAt: input.decisionAt,
    riskPolicyUseMode: input.riskPolicyUseMode,
    riskPolicyUseAt: input.riskPolicyUseAt,
    backtestId: input.backtestId,
    runCreatedAt: input.runCreatedAt,
    signalExpiresAt: input.signalExpiresAt,
    entryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    datasetVersion: input.datasetVersion,
    strategyVersion: input.strategyVersion,
    riskPolicyVersion: input.policy.version,
    fxVersion: input.snapshots.fx?.version ?? null,
    marginVersion: input.snapshots.margin?.version ?? null,
    costModelVersion: input.snapshots.costs.version,
    eligibilityVersion: input.snapshots.eligibility?.version ?? null,
    productCode: input.product.productCode,
    contractId: input.contract.contractId,
  });
}

function staticReasons(
  input: ValidatedInput,
  sizingEquity: DecimalString,
): Set<RiskDecisionReason> {
  const reasons = new Set<RiskDecisionReason>();
  if (input.account.killSwitchActive) reasons.add('KILL_SWITCH');
  if (compareInstant(input.decisionAt, input.signalExpiresAt) >= 0) {
    reasons.add('SIGNAL_EXPIRED');
  }
  if (
    input.portfolio.positions.some(
      (position) => position.instrumentId === input.instrumentId,
    )
  ) {
    reasons.add('POSITION_ALREADY_ACTIVE');
  }
  if (
    input.portfolio.activeEntryIntents.some(
      (intent) => intent.instrumentId === input.instrumentId,
    )
  ) {
    reasons.add('ENTRY_INTENT_ALREADY_ACTIVE');
  }
  if (input.portfolio.positions.length >= input.policy.maxOpenPositions) {
    reasons.add('MAX_POSITIONS');
  }
  if (
    input.requestedQuantity !== null &&
    riskDecimalFrom(input.requestedQuantity).gt(
      riskDecimalFrom(input.policy.maxContractsPerPosition),
    )
  ) {
    reasons.add('MAX_CONTRACTS_PER_POSITION');
  }
  const equity = riskDecimalFrom(sizingEquity);
  const dailyLoss = riskDecimalFrom(input.account.dailyLoss);
  if (
    dailyLoss.gt(0) &&
    dailyLoss.gte(
      equity.times(riskDecimalFrom(input.policy.dailyLossLimitPct)).div(100),
    )
  ) {
    reasons.add('DAILY_LOSS_LIMIT');
  }
  const drawdownPct = riskDecimalFrom(input.account.drawdownPct);
  if (
    drawdownPct.gt(0) &&
    drawdownPct.gte(riskDecimalFrom(input.policy.maxDrawdownPct))
  ) {
    reasons.add('DRAWDOWN_LIMIT');
  }
  if (equity.lte(0)) reasons.add('NO_SIZING_EQUITY');
  const requiresFx =
    input.product.pnlCurrency !== input.account.accountCurrency;
  if (requiresFx && input.snapshots.fx === null) {
    reasons.add('MISSING_FX');
  } else if (
    requiresFx &&
    input.snapshots.fx !== null &&
    !isCurrent(input.snapshots.fx, input.decisionAt)
  ) {
    reasons.add('STALE_FX');
  }
  if (input.snapshots.margin === null) {
    reasons.add('MISSING_MARGIN');
  } else if (!isCurrent(input.snapshots.margin, input.decisionAt)) {
    reasons.add('STALE_MARGIN');
  }
  if (input.snapshots.eligibility === null) {
    reasons.add('MISSING_ELIGIBILITY');
  } else if (!isCurrent(input.snapshots.eligibility, input.decisionAt)) {
    reasons.add('STALE_ELIGIBILITY');
  } else if (!input.snapshots.eligibility.eligible) {
    reasons.add('INELIGIBLE_CONTRACT');
  }
  return reasons;
}

function reject(
  reasons: ReadonlySet<RiskDecisionReason>,
  economics: Readonly<CandidateEconomics> | null,
  context: Readonly<RiskDecisionContext>,
): RiskDecision {
  return Object.freeze({
    status: 'REJECT',
    quantity: asDecimalString('0'),
    reasons: orderedReasons(reasons),
    economics,
    context,
  });
}

interface CandidateEvaluation {
  readonly economics: Readonly<CandidateEconomics>;
  readonly reasons: ReadonlySet<RiskDecisionReason>;
}

interface Limits {
  readonly riskBudget: ReturnType<typeof riskDecimalFrom>;
  readonly maxOpenRisk: ReturnType<typeof riskDecimalFrom>;
  readonly maxMargin: ReturnType<typeof riskDecimalFrom>;
  readonly maxGrossExposure: ReturnType<typeof riskDecimalFrom>;
  readonly maxRiskGroupExposure: ReturnType<typeof riskDecimalFrom>;
  readonly reserve: ReturnType<typeof riskDecimalFrom>;
  readonly riskGroupExposure: ReturnType<typeof riskDecimalFrom>;
}

function resolveRiskGroupLimit(input: ValidatedInput): DecimalString {
  if (
    !Object.hasOwn(
      input.policy.riskGroupMaxExposurePct,
      input.product.riskGroup,
    )
  ) {
    invalid('The risk policy does not define the product risk group.', {
      riskGroup: input.product.riskGroup,
    });
  }
  return input.policy.riskGroupMaxExposurePct[
    input.product.riskGroup
  ] as DecimalString;
}

function limits(
  input: ValidatedInput,
  sizingEquity: DecimalString,
  groupPct: DecimalString,
): Limits {
  const equity = riskDecimalFrom(sizingEquity);
  const pct = (value: DecimalString) =>
    equity.times(riskDecimalFrom(value)).div(100);
  let groupExposure = riskDecimalFrom('0');
  for (const position of input.portfolio.positions) {
    if (position.riskGroup === input.product.riskGroup) {
      groupExposure = groupExposure.plus(
        riskDecimalFrom(position.grossExposure),
      );
    }
  }
  return {
    riskBudget: pct(input.policy.riskPerTradePct),
    maxOpenRisk: pct(input.policy.maxOpenRiskPct),
    maxMargin: pct(input.policy.maxMarginUsagePct),
    maxGrossExposure: pct(input.policy.maxGrossExposurePct),
    maxRiskGroupExposure: pct(groupPct),
    reserve: pct(input.policy.cashReservePct),
    riskGroupExposure: groupExposure,
  };
}

interface CandidateReadyInput extends CostCoveredInput {
  readonly snapshots: CostCoveredInput['snapshots'] & {
    readonly margin: Readonly<MarginSnapshot>;
  };
}

function candidateInputsAreReady(
  input: CostCoveredInput,
  reasons: ReadonlySet<RiskDecisionReason>,
): input is CandidateReadyInput {
  return (
    input.snapshots.margin !== null &&
    ![
      'MISSING_FX',
      'STALE_FX',
      'STALE_MARGIN',
      'MISSING_ELIGIBILITY',
      'STALE_ELIGIBILITY',
    ].some((reason) => reasons.has(reason as RiskDecisionReason))
  );
}

function evaluateCandidate(
  input: CandidateReadyInput,
  quantity: DecimalString,
  allowed: Limits,
): CandidateEvaluation {
  const economics = calculateCandidateEconomics({
    direction: input.direction,
    entryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    quantity,
    product: input.product,
    accountCurrency: input.account.accountCurrency,
    fx: input.snapshots.fx,
    margin: input.snapshots.margin,
    costs: input.snapshots.costs,
  });
  const reasons = new Set<RiskDecisionReason>();
  const loss = riskDecimalFrom(economics.worstCaseBudgetedLossAccount);
  const candidateMargin = riskDecimalFrom(economics.initialMarginAccount);
  const exposure = riskDecimalFrom(economics.grossExposureAccount);
  if (loss.gt(allowed.riskBudget)) reasons.add('RISK_BUDGET');
  if (
    riskDecimalFrom(input.account.openRisk).plus(loss).gt(allowed.maxOpenRisk)
  ) {
    reasons.add('OPEN_RISK');
  }
  if (
    riskDecimalFrom(input.account.usedMargin)
      .plus(candidateMargin)
      .gt(allowed.maxMargin)
  ) {
    reasons.add('MARGIN');
  }
  if (
    riskDecimalFrom(input.account.grossExposure)
      .plus(exposure)
      .gt(allowed.maxGrossExposure)
  ) {
    reasons.add('GROSS_EXPOSURE');
  }
  if (
    allowed.riskGroupExposure.plus(exposure).gt(allowed.maxRiskGroupExposure)
  ) {
    reasons.add('RISK_GROUP_EXPOSURE');
  }
  if (
    riskDecimalFrom(input.account.availableFunds)
      .minus(candidateMargin)
      .minus(riskDecimalFrom(economics.estimatedCostsAccount))
      .lt(allowed.reserve)
  ) {
    reasons.add('AVAILABLE_FUNDS');
  }
  return { economics, reasons };
}

function gridSize(input: ValidatedInput): number {
  const minimum = riskDecimalFrom(input.product.minQuantity);
  const maximum = riskDecimalFrom(input.policy.maxContractsPerPosition);
  const step = riskDecimalFrom(input.product.quantityStep);
  if (maximum.lt(minimum)) return 0;
  const count = maximum.minus(minimum).div(step).floor().plus(1);
  if (count.gt(MAX_GRID_ITERATIONS)) {
    fail(
      'GRID_TOO_LARGE',
      'The exact quantity grid exceeds its safety bound.',
      {
        limit: MAX_GRID_ITERATIONS,
      },
    );
  }
  return count.toNumber();
}

export function evaluateOrderRisk(input: OrderRiskInput): RiskDecision {
  const validated = validatedInput(input);
  assertSnapshotConsistency(validated);
  const groupPct = resolveRiskGroupLimit(validated);
  const count = gridSize(validated);
  const context = buildContext(validated);
  const sizingEquity = calculateSizingEquity(
    validated.account,
    validated.policy,
  );
  const reasons = staticReasons(validated, sizingEquity);
  const requested = validated.requestedQuantity;
  const minimum = riskDecimalFrom(validated.product.minQuantity);
  if (requested !== null && riskDecimalFrom(requested).lt(minimum)) {
    reasons.add('MIN_QUANTITY');
    return reject(reasons, null, context);
  }
  if (count === 0) {
    reasons.add('MIN_QUANTITY');
    return reject(reasons, null, context);
  }
  if (!candidateInputsAreReady(validated, reasons)) {
    return reject(reasons, null, context);
  }

  const allowed = limits(validated, sizingEquity, groupPct);
  const cap = riskDecimalFrom(validated.policy.maxContractsPerPosition);
  const requestedValue = requested === null ? null : riskDecimalFrom(requested);
  const upper =
    requestedValue === null || requestedValue.gt(cap) ? cap : requestedValue;
  const step = riskDecimalFrom(validated.product.quantityStep);
  const minimumQuantity = riskDecimalToString(minimum);
  const minimumEvaluation = evaluateCandidate(
    validated,
    minimumQuantity,
    allowed,
  );
  const hasBlockingStaticReason = [...reasons].some(
    (reason) => reason !== 'MAX_CONTRACTS_PER_POSITION',
  );
  if (hasBlockingStaticReason) {
    for (const reason of minimumEvaluation.reasons) reasons.add(reason);
    return reject(reasons, minimumEvaluation.economics, context);
  }
  let greatest: Readonly<{
    evaluation: CandidateEvaluation;
    quantity: DecimalString;
  }> | null =
    minimumEvaluation.reasons.size === 0
      ? { evaluation: minimumEvaluation, quantity: minimumQuantity }
      : null;

  for (let index = 0; index < count; index += 1) {
    const quantityValue = minimum.plus(step.times(index));
    if (quantityValue.gt(upper)) break;
    const quantity = riskDecimalToString(quantityValue);
    const evaluated =
      index === 0
        ? minimumEvaluation
        : evaluateCandidate(validated, quantity, allowed);
    if (evaluated.reasons.size === 0) {
      greatest = { evaluation: evaluated, quantity };
    }
  }

  if (greatest === null) {
    for (const reason of minimumEvaluation.reasons) reasons.add(reason);
    return reject(reasons, minimumEvaluation.economics, context);
  }
  if (requested === null) {
    return Object.freeze({
      status: 'APPROVE',
      quantity: greatest.quantity,
      reasons: noReasons,
      economics: greatest.evaluation.economics,
      context,
    });
  }
  const explicitRequestedValue = riskDecimalFrom(requested);
  const explicitEvaluation = evaluateCandidate(validated, requested, allowed);
  if (explicitRequestedValue.gt(cap)) {
    const reductionReasons = new Set<RiskDecisionReason>(
      explicitEvaluation.reasons,
    );
    reductionReasons.add('MAX_CONTRACTS_PER_POSITION');
    return Object.freeze({
      status: 'REDUCE_SIZE',
      requestedQuantity: requested,
      quantity: greatest.quantity,
      reasons: orderedReasons(reductionReasons),
      economics: greatest.evaluation.economics,
      context,
    });
  }
  if (
    explicitRequestedValue.eq(riskDecimalFrom(greatest.quantity)) &&
    explicitEvaluation.reasons.size === 0
  ) {
    return Object.freeze({
      status: 'APPROVE',
      quantity: greatest.quantity,
      reasons: noReasons,
      economics: greatest.evaluation.economics,
      context,
    });
  }
  return Object.freeze({
    status: 'REDUCE_SIZE',
    requestedQuantity: requested,
    quantity: greatest.quantity,
    reasons: orderedReasons(explicitEvaluation.reasons),
    economics: greatest.evaluation.economics,
    context,
  });
}
