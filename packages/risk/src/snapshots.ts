import { Temporal } from '@js-temporal/polyfill';
import {
  asCurrencyCode,
  asDecimalString,
  asInstantString,
  type CurrencyCode,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';

import { riskDecimalFrom } from './decimal.js';
import { RiskInputError, type RiskInputErrorCode } from './errors.js';

export interface SnapshotMetadataInput {
  version: string;
  source: string;
  observedAt: string;
  validFrom: string;
  validUntil: string;
}

export interface SnapshotMetadata {
  readonly version: string;
  readonly source: string;
  readonly observedAt: InstantString;
  readonly validFrom: InstantString;
  readonly validUntil: InstantString;
}

export interface FxSnapshotInput extends SnapshotMetadataInput {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
}

export interface FxSnapshot extends SnapshotMetadata {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly rate: DecimalString;
}

export interface MarginSnapshotInput extends SnapshotMetadataInput {
  contractId: string;
  currency: string;
  initialMarginPerContract: string;
  maintenanceMarginPerContract: string;
}

export interface MarginSnapshot extends SnapshotMetadata {
  readonly contractId: string;
  readonly currency: CurrencyCode;
  readonly initialMarginPerContract: DecimalString;
  readonly maintenanceMarginPerContract: DecimalString;
}

export interface EligibilitySnapshotInput extends SnapshotMetadataInput {
  contractId: string;
  researchOnly: boolean;
  eligible: boolean;
  reason: string | null;
}

export interface EligibilitySnapshot extends SnapshotMetadata {
  readonly contractId: string;
  readonly researchOnly: boolean;
  readonly eligible: boolean;
  readonly reason: string | null;
}

export interface FeeTierInput {
  upToQuantity: string | null;
  feePerContract: string;
}

export interface FeeTier {
  readonly upToQuantity: DecimalString | null;
  readonly feePerContract: DecimalString;
}

export interface FeeScheduleInput {
  minimum: string;
  tiers: readonly FeeTierInput[];
}

export interface FeeSchedule {
  readonly minimum: DecimalString;
  readonly tiers: readonly Readonly<FeeTier>[];
}

export interface CostModelSnapshotInput extends SnapshotMetadataInput {
  contractId: string;
  currency: string;
  entryFees: FeeScheduleInput;
  exitFees: FeeScheduleInput;
  spreadPriceUnitsRoundTrip: string;
  adverseEntrySlippagePriceUnits: string;
  adverseExitSlippagePriceUnits: string;
}

export interface CostModelSnapshot extends SnapshotMetadata {
  readonly contractId: string;
  readonly currency: CurrencyCode;
  readonly entryFees: Readonly<FeeSchedule>;
  readonly exitFees: Readonly<FeeSchedule>;
  readonly spreadPriceUnitsRoundTrip: DecimalString;
  readonly adverseEntrySlippagePriceUnits: DecimalString;
  readonly adverseExitSlippagePriceUnits: DecimalString;
}

export interface RiskSnapshotSeriesInput {
  fx: readonly FxSnapshotInput[];
  margin: readonly MarginSnapshotInput[];
  eligibility: readonly EligibilitySnapshotInput[];
  costs: readonly CostModelSnapshotInput[];
}

export interface RiskSnapshotSelectionQueryInput {
  decisionAt: string;
  contractId: string;
  pnlCurrency: string;
  accountCurrency: string;
}

export interface RiskSnapshotSelectionQuery {
  readonly decisionAt: InstantString;
  readonly contractId: string;
  readonly pnlCurrency: CurrencyCode;
  readonly accountCurrency: CurrencyCode;
}

export interface RiskSnapshotBundle {
  readonly fx: Readonly<FxSnapshot> | null;
  readonly margin: Readonly<MarginSnapshot> | null;
  readonly eligibility: Readonly<EligibilitySnapshot> | null;
  readonly costs: Readonly<CostModelSnapshot> | null;
}

type Invalid = (
  message: string,
  details?: Readonly<Record<string, unknown>>,
) => never;

interface UnknownMetadata {
  version: unknown;
  source: unknown;
  observedAt: unknown;
  validFrom: unknown;
  validUntil: unknown;
}

function fail(
  code: RiskInputErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new RiskInputError(code, message, details);
}

const invalidSnapshot: Invalid = (message, details) =>
  fail('INVALID_SNAPSHOT', message, details);
const invalidRiskInput: Invalid = (message, details) =>
  fail('INVALID_RISK_INPUT', message, details);

function assertObject(
  value: unknown,
  field: string,
  invalid: Invalid,
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
  property: string,
  field: string,
  invalid: Invalid,
): unknown {
  try {
    return input[property];
  } catch {
    invalid(`${field} must be readable.`, { field });
  }
}

function assertString(
  value: unknown,
  field: string,
  invalid: Invalid,
): asserts value is string {
  if (typeof value !== 'string') {
    invalid(`${field} must be a string.`, { field, value });
  }
}

function assertNonBlankString(
  value: unknown,
  field: string,
  invalid: Invalid,
): asserts value is string {
  assertString(value, field, invalid);

  if (value.trim().length === 0) {
    invalid(`${field} must be a nonblank string.`, { field, value });
  }
}

function assertBoolean(
  value: unknown,
  field: string,
  invalid: Invalid,
): asserts value is boolean {
  if (typeof value !== 'boolean') {
    invalid(`${field} must be a boolean.`, { field, value });
  }
}

function instant(
  value: unknown,
  field: string,
  invalid: Invalid,
): InstantString {
  assertString(value, field, invalid);

  try {
    return asInstantString(value);
  } catch {
    invalid(`${field} must be an ISO-8601 instant.`, { field, value });
  }
}

function currency(
  value: unknown,
  field: string,
  invalid: Invalid,
): CurrencyCode {
  assertString(value, field, invalid);

  try {
    return asCurrencyCode(value);
  } catch {
    invalid(`${field} must be a currency code.`, { field, value });
  }
}

function decimal(
  value: unknown,
  field: string,
  invalid: Invalid,
): DecimalString {
  assertString(value, field, invalid);

  try {
    return asDecimalString(value);
  } catch {
    invalid(`${field} must be a canonical finite decimal.`, { field, value });
  }
}

function positiveDecimal(
  value: unknown,
  field: string,
  invalid: Invalid,
): DecimalString {
  const validated = decimal(value, field, invalid);

  if (riskDecimalFrom(validated).lte(0)) {
    invalid(`${field} must be greater than zero.`, { field, value });
  }

  return validated;
}

function nonnegativeDecimal(
  value: unknown,
  field: string,
  invalid: Invalid,
): DecimalString {
  const validated = decimal(value, field, invalid);

  if (riskDecimalFrom(validated).isNegative()) {
    invalid(`${field} must be nonnegative.`, { field, value });
  }

  return validated;
}

function snapshotMetadata(
  input: Record<string, unknown>,
  invalid: Invalid,
): UnknownMetadata {
  return {
    version: snapshotProperty(input, 'version', 'version', invalid),
    source: snapshotProperty(input, 'source', 'source', invalid),
    observedAt: snapshotProperty(input, 'observedAt', 'observedAt', invalid),
    validFrom: snapshotProperty(input, 'validFrom', 'validFrom', invalid),
    validUntil: snapshotProperty(input, 'validUntil', 'validUntil', invalid),
  };
}

function validateMetadata(
  input: UnknownMetadata,
  invalid: Invalid,
): SnapshotMetadata {
  assertNonBlankString(input.version, 'version', invalid);
  assertNonBlankString(input.source, 'source', invalid);
  const observedAt = instant(input.observedAt, 'observedAt', invalid);
  const validFrom = instant(input.validFrom, 'validFrom', invalid);
  const validUntil = instant(input.validUntil, 'validUntil', invalid);

  if (Temporal.Instant.compare(validFrom, validUntil) >= 0) {
    invalid('validFrom must precede validUntil.', { validFrom, validUntil });
  }

  return {
    version: input.version,
    source: input.source,
    observedAt,
    validFrom,
    validUntil,
  };
}

export function createFxSnapshot(input: FxSnapshotInput): FxSnapshot {
  assertObject(input, 'input', invalidSnapshot);
  const raw = {
    ...snapshotMetadata(input, invalidSnapshot),
    baseCurrency: snapshotProperty(
      input,
      'baseCurrency',
      'baseCurrency',
      invalidSnapshot,
    ),
    quoteCurrency: snapshotProperty(
      input,
      'quoteCurrency',
      'quoteCurrency',
      invalidSnapshot,
    ),
    rate: snapshotProperty(input, 'rate', 'rate', invalidSnapshot),
  };
  const metadataValue = validateMetadata(raw, invalidSnapshot);
  const baseCurrency = currency(
    raw.baseCurrency,
    'baseCurrency',
    invalidSnapshot,
  );
  const quoteCurrency = currency(
    raw.quoteCurrency,
    'quoteCurrency',
    invalidSnapshot,
  );

  if (baseCurrency === quoteCurrency) {
    invalidSnapshot('FX currencies must be distinct.', {
      baseCurrency,
      quoteCurrency,
    });
  }

  return Object.freeze({
    ...metadataValue,
    baseCurrency,
    quoteCurrency,
    rate: positiveDecimal(raw.rate, 'rate', invalidSnapshot),
  });
}

export function createMarginSnapshot(
  input: MarginSnapshotInput,
): MarginSnapshot {
  assertObject(input, 'input', invalidSnapshot);
  const raw = {
    ...snapshotMetadata(input, invalidSnapshot),
    contractId: snapshotProperty(
      input,
      'contractId',
      'contractId',
      invalidSnapshot,
    ),
    currency: snapshotProperty(input, 'currency', 'currency', invalidSnapshot),
    initialMarginPerContract: snapshotProperty(
      input,
      'initialMarginPerContract',
      'initialMarginPerContract',
      invalidSnapshot,
    ),
    maintenanceMarginPerContract: snapshotProperty(
      input,
      'maintenanceMarginPerContract',
      'maintenanceMarginPerContract',
      invalidSnapshot,
    ),
  };
  const metadataValue = validateMetadata(raw, invalidSnapshot);
  assertNonBlankString(raw.contractId, 'contractId', invalidSnapshot);
  const initialMarginPerContract = positiveDecimal(
    raw.initialMarginPerContract,
    'initialMarginPerContract',
    invalidSnapshot,
  );
  const maintenanceMarginPerContract = positiveDecimal(
    raw.maintenanceMarginPerContract,
    'maintenanceMarginPerContract',
    invalidSnapshot,
  );

  if (
    riskDecimalFrom(maintenanceMarginPerContract).gt(
      riskDecimalFrom(initialMarginPerContract),
    )
  ) {
    invalidSnapshot(
      'maintenanceMarginPerContract must not exceed initialMarginPerContract.',
      { initialMarginPerContract, maintenanceMarginPerContract },
    );
  }

  return Object.freeze({
    ...metadataValue,
    contractId: raw.contractId,
    currency: currency(raw.currency, 'currency', invalidSnapshot),
    initialMarginPerContract,
    maintenanceMarginPerContract,
  });
}

export function createEligibilitySnapshot(
  input: EligibilitySnapshotInput,
): EligibilitySnapshot {
  assertObject(input, 'input', invalidSnapshot);
  const raw = {
    ...snapshotMetadata(input, invalidSnapshot),
    contractId: snapshotProperty(
      input,
      'contractId',
      'contractId',
      invalidSnapshot,
    ),
    researchOnly: snapshotProperty(
      input,
      'researchOnly',
      'researchOnly',
      invalidSnapshot,
    ),
    eligible: snapshotProperty(input, 'eligible', 'eligible', invalidSnapshot),
    reason: snapshotProperty(input, 'reason', 'reason', invalidSnapshot),
  };
  const metadataValue = validateMetadata(raw, invalidSnapshot);
  assertNonBlankString(raw.contractId, 'contractId', invalidSnapshot);
  assertBoolean(raw.researchOnly, 'researchOnly', invalidSnapshot);
  assertBoolean(raw.eligible, 'eligible', invalidSnapshot);

  if (raw.eligible) {
    if (raw.reason !== null) {
      invalidSnapshot('Eligible snapshots require a null reason.', {
        field: 'reason',
        value: raw.reason,
      });
    }
  } else {
    assertNonBlankString(raw.reason, 'reason', invalidSnapshot);
  }

  return Object.freeze({
    ...metadataValue,
    contractId: raw.contractId,
    researchOnly: raw.researchOnly,
    eligible: raw.eligible,
    reason: raw.reason,
  });
}

interface DenseArrayView {
  readonly input: Record<string, unknown>;
  readonly length: number;
}

// Trust-boundary caps keep proxy-controlled iteration and retained tie state bounded.
const MAX_SNAPSHOT_SERIES_LENGTH = 10_000;
const MAX_FEE_TIERS = 256;

function snapshotDenseArrayView(
  value: unknown,
  field: string,
  invalid: Invalid,
  limit: number,
): DenseArrayView {
  let isArray: boolean;

  try {
    isArray = Array.isArray(value);
  } catch {
    invalid(`${field} must be a dense array.`, { field });
  }

  if (!isArray) {
    invalid(`${field} must be a dense array.`, { field });
  }

  const array = value as unknown[];
  const lengthValue = snapshotProperty(
    array as unknown as Record<string, unknown>,
    'length',
    `${field}.length`,
    invalid,
  );

  if (!Number.isSafeInteger(lengthValue) || (lengthValue as number) < 0) {
    invalid(`${field} must have a valid length.`, {
      field,
      length: lengthValue,
    });
  }

  if ((lengthValue as number) > limit) {
    invalid(`${field} exceeds its supported length.`, {
      field,
      length: lengthValue,
      limit,
    });
  }

  for (let index = 0; index < (lengthValue as number); index += 1) {
    let hasIndex: boolean;

    try {
      hasIndex = Object.hasOwn(array, index);
    } catch {
      invalid(`${field} must be a dense array.`, { field });
    }

    if (!hasIndex) {
      invalid(`${field} must be a dense array.`, { field });
    }
  }

  return {
    input: array as unknown as Record<string, unknown>,
    length: lengthValue as number,
  };
}

function snapshotDenseArray(
  value: unknown,
  field: string,
  invalid: Invalid,
  limit: number,
): readonly unknown[] {
  const view = snapshotDenseArrayView(value, field, invalid, limit);
  const items: unknown[] = [];

  for (let index = 0; index < view.length; index += 1) {
    items.push(
      snapshotProperty(
        view.input,
        String(index),
        `${field}[${String(index)}]`,
        invalid,
      ),
    );
  }

  return items;
}

function createFeeTier(
  input: unknown,
  field: string,
  isFinal: boolean,
  previousUpperBound: DecimalString | null,
): FeeTier {
  assertObject(input, field, invalidSnapshot);
  const rawUpToQuantity = snapshotProperty(
    input,
    'upToQuantity',
    `${field}.upToQuantity`,
    invalidSnapshot,
  );
  const rawFeePerContract = snapshotProperty(
    input,
    'feePerContract',
    `${field}.feePerContract`,
    invalidSnapshot,
  );

  if (isFinal) {
    if (rawUpToQuantity !== null) {
      invalidSnapshot('The final fee tier must be open-ended.', {
        field: `${field}.upToQuantity`,
        value: rawUpToQuantity,
      });
    }
  } else if (rawUpToQuantity === null) {
    invalidSnapshot('Only the final fee tier may be open-ended.', {
      field: `${field}.upToQuantity`,
      value: rawUpToQuantity,
    });
  }

  const upToQuantity =
    rawUpToQuantity === null
      ? null
      : positiveDecimal(
          rawUpToQuantity,
          `${field}.upToQuantity`,
          invalidSnapshot,
        );

  if (
    upToQuantity !== null &&
    previousUpperBound !== null &&
    riskDecimalFrom(upToQuantity).lte(riskDecimalFrom(previousUpperBound))
  ) {
    invalidSnapshot('Fee tier upper bounds must strictly increase.', {
      field: `${field}.upToQuantity`,
      previous: previousUpperBound,
      value: upToQuantity,
    });
  }

  return Object.freeze({
    upToQuantity,
    feePerContract: nonnegativeDecimal(
      rawFeePerContract,
      `${field}.feePerContract`,
      invalidSnapshot,
    ),
  });
}

function createFeeSchedule(input: unknown, field: string): FeeSchedule {
  assertObject(input, field, invalidSnapshot);
  const rawMinimum = snapshotProperty(
    input,
    'minimum',
    `${field}.minimum`,
    invalidSnapshot,
  );
  const rawTiers = snapshotProperty(
    input,
    'tiers',
    `${field}.tiers`,
    invalidSnapshot,
  );
  const tierInputs = snapshotDenseArray(
    rawTiers,
    `${field}.tiers`,
    invalidSnapshot,
    MAX_FEE_TIERS,
  );

  if (tierInputs.length === 0) {
    invalidSnapshot(`${field}.tiers must not be empty.`, {
      field: `${field}.tiers`,
    });
  }

  const tiers: FeeTier[] = [];
  let previousUpperBound: DecimalString | null = null;
  for (let index = 0; index < tierInputs.length; index += 1) {
    const tier = createFeeTier(
      tierInputs[index],
      `${field}.tiers[${String(index)}]`,
      index === tierInputs.length - 1,
      previousUpperBound,
    );
    tiers.push(tier);

    if (tier.upToQuantity !== null) {
      previousUpperBound = tier.upToQuantity;
    }
  }

  return Object.freeze({
    minimum: nonnegativeDecimal(
      rawMinimum,
      `${field}.minimum`,
      invalidSnapshot,
    ),
    tiers: Object.freeze(tiers),
  });
}

export function createCostModelSnapshot(
  input: CostModelSnapshotInput,
): CostModelSnapshot {
  assertObject(input, 'input', invalidSnapshot);
  const raw = {
    ...snapshotMetadata(input, invalidSnapshot),
    contractId: snapshotProperty(
      input,
      'contractId',
      'contractId',
      invalidSnapshot,
    ),
    currency: snapshotProperty(input, 'currency', 'currency', invalidSnapshot),
    entryFees: snapshotProperty(
      input,
      'entryFees',
      'entryFees',
      invalidSnapshot,
    ),
    exitFees: snapshotProperty(input, 'exitFees', 'exitFees', invalidSnapshot),
    spreadPriceUnitsRoundTrip: snapshotProperty(
      input,
      'spreadPriceUnitsRoundTrip',
      'spreadPriceUnitsRoundTrip',
      invalidSnapshot,
    ),
    adverseEntrySlippagePriceUnits: snapshotProperty(
      input,
      'adverseEntrySlippagePriceUnits',
      'adverseEntrySlippagePriceUnits',
      invalidSnapshot,
    ),
    adverseExitSlippagePriceUnits: snapshotProperty(
      input,
      'adverseExitSlippagePriceUnits',
      'adverseExitSlippagePriceUnits',
      invalidSnapshot,
    ),
  };
  const metadataValue = validateMetadata(raw, invalidSnapshot);
  assertNonBlankString(raw.contractId, 'contractId', invalidSnapshot);

  return Object.freeze({
    ...metadataValue,
    contractId: raw.contractId,
    currency: currency(raw.currency, 'currency', invalidSnapshot),
    entryFees: createFeeSchedule(raw.entryFees, 'entryFees'),
    exitFees: createFeeSchedule(raw.exitFees, 'exitFees'),
    spreadPriceUnitsRoundTrip: nonnegativeDecimal(
      raw.spreadPriceUnitsRoundTrip,
      'spreadPriceUnitsRoundTrip',
      invalidSnapshot,
    ),
    adverseEntrySlippagePriceUnits: nonnegativeDecimal(
      raw.adverseEntrySlippagePriceUnits,
      'adverseEntrySlippagePriceUnits',
      invalidSnapshot,
    ),
    adverseExitSlippagePriceUnits: nonnegativeDecimal(
      raw.adverseExitSlippagePriceUnits,
      'adverseExitSlippagePriceUnits',
      invalidSnapshot,
    ),
  });
}

interface SnapshotSeriesViews {
  readonly fx: DenseArrayView;
  readonly margin: DenseArrayView;
  readonly eligibility: DenseArrayView;
  readonly costs: DenseArrayView;
}

function snapshotSeriesViews(input: unknown): SnapshotSeriesViews {
  assertObject(input, 'series', invalidRiskInput);
  const raw = {
    fx: snapshotProperty(input, 'fx', 'fx', invalidRiskInput),
    margin: snapshotProperty(input, 'margin', 'margin', invalidRiskInput),
    eligibility: snapshotProperty(
      input,
      'eligibility',
      'eligibility',
      invalidRiskInput,
    ),
    costs: snapshotProperty(input, 'costs', 'costs', invalidRiskInput),
  };

  return {
    fx: snapshotDenseArrayView(
      raw.fx,
      'fx',
      invalidRiskInput,
      MAX_SNAPSHOT_SERIES_LENGTH,
    ),
    margin: snapshotDenseArrayView(
      raw.margin,
      'margin',
      invalidRiskInput,
      MAX_SNAPSHOT_SERIES_LENGTH,
    ),
    eligibility: snapshotDenseArrayView(
      raw.eligibility,
      'eligibility',
      invalidRiskInput,
      MAX_SNAPSHOT_SERIES_LENGTH,
    ),
    costs: snapshotDenseArrayView(
      raw.costs,
      'costs',
      invalidRiskInput,
      MAX_SNAPSHOT_SERIES_LENGTH,
    ),
  };
}

function validateQuery(input: unknown): RiskSnapshotSelectionQuery {
  assertObject(input, 'query', invalidRiskInput);
  const raw = {
    decisionAt: snapshotProperty(
      input,
      'decisionAt',
      'decisionAt',
      invalidRiskInput,
    ),
    contractId: snapshotProperty(
      input,
      'contractId',
      'contractId',
      invalidRiskInput,
    ),
    pnlCurrency: snapshotProperty(
      input,
      'pnlCurrency',
      'pnlCurrency',
      invalidRiskInput,
    ),
    accountCurrency: snapshotProperty(
      input,
      'accountCurrency',
      'accountCurrency',
      invalidRiskInput,
    ),
  };
  assertNonBlankString(raw.contractId, 'contractId', invalidRiskInput);

  return Object.freeze({
    decisionAt: instant(raw.decisionAt, 'decisionAt', invalidRiskInput),
    contractId: raw.contractId,
    pnlCurrency: currency(raw.pnlCurrency, 'pnlCurrency', invalidRiskInput),
    accountCurrency: currency(
      raw.accountCurrency,
      'accountCurrency',
      invalidRiskInput,
    ),
  });
}

interface ObservableRecord {
  readonly input: Record<string, unknown>;
  readonly observedAt: InstantString;
}

function observableRecord(
  view: DenseArrayView,
  index: number,
  field: string,
  decisionAt: InstantString,
): ObservableRecord | null {
  const input = snapshotProperty(
    view.input,
    String(index),
    `${field}[${String(index)}]`,
    invalidRiskInput,
  );
  assertObject(input, 'input', invalidSnapshot);
  const rawObservedAt = snapshotProperty(
    input,
    'observedAt',
    'observedAt',
    invalidSnapshot,
  );
  const observedAt = instant(rawObservedAt, 'observedAt', invalidSnapshot);

  if (Temporal.Instant.compare(observedAt, decisionAt) > 0) {
    return null;
  }

  return { input, observedAt };
}

function remainingMetadata(
  input: Record<string, unknown>,
  observedAt: InstantString,
): Readonly<Record<string, unknown>> {
  return {
    version: snapshotProperty(input, 'version', 'version', invalidSnapshot),
    source: snapshotProperty(input, 'source', 'source', invalidSnapshot),
    observedAt,
    validFrom: snapshotProperty(
      input,
      'validFrom',
      'validFrom',
      invalidSnapshot,
    ),
    validUntil: snapshotProperty(
      input,
      'validUntil',
      'validUntil',
      invalidSnapshot,
    ),
  };
}

function routedContractId(input: Record<string, unknown>): string {
  const contractId = snapshotProperty(
    input,
    'contractId',
    'contractId',
    invalidSnapshot,
  );
  assertNonBlankString(contractId, 'contractId', invalidSnapshot);
  return contractId;
}

function relevantFxSnapshot(
  record: ObservableRecord,
  query: RiskSnapshotSelectionQuery,
): FxSnapshot | null {
  const rawBaseCurrency = snapshotProperty(
    record.input,
    'baseCurrency',
    'baseCurrency',
    invalidSnapshot,
  );
  const rawQuoteCurrency = snapshotProperty(
    record.input,
    'quoteCurrency',
    'quoteCurrency',
    invalidSnapshot,
  );
  const baseCurrency = currency(
    rawBaseCurrency,
    'baseCurrency',
    invalidSnapshot,
  );
  const quoteCurrency = currency(
    rawQuoteCurrency,
    'quoteCurrency',
    invalidSnapshot,
  );

  if (baseCurrency === quoteCurrency) {
    invalidSnapshot('FX currencies must be distinct.', {
      baseCurrency,
      quoteCurrency,
    });
  }

  const matches =
    (baseCurrency === query.pnlCurrency &&
      quoteCurrency === query.accountCurrency) ||
    (baseCurrency === query.accountCurrency &&
      quoteCurrency === query.pnlCurrency);

  if (!matches) {
    return null;
  }

  return createFxSnapshot({
    ...remainingMetadata(record.input, record.observedAt),
    baseCurrency,
    quoteCurrency,
    rate: snapshotProperty(record.input, 'rate', 'rate', invalidSnapshot),
  } as unknown as FxSnapshotInput);
}

function relevantMarginSnapshot(
  record: ObservableRecord,
  query: RiskSnapshotSelectionQuery,
): MarginSnapshot | null {
  const contractId = routedContractId(record.input);

  if (contractId !== query.contractId) {
    return null;
  }

  return createMarginSnapshot({
    ...remainingMetadata(record.input, record.observedAt),
    contractId,
    currency: snapshotProperty(
      record.input,
      'currency',
      'currency',
      invalidSnapshot,
    ),
    initialMarginPerContract: snapshotProperty(
      record.input,
      'initialMarginPerContract',
      'initialMarginPerContract',
      invalidSnapshot,
    ),
    maintenanceMarginPerContract: snapshotProperty(
      record.input,
      'maintenanceMarginPerContract',
      'maintenanceMarginPerContract',
      invalidSnapshot,
    ),
  } as unknown as MarginSnapshotInput);
}

function relevantEligibilitySnapshot(
  record: ObservableRecord,
  query: RiskSnapshotSelectionQuery,
): EligibilitySnapshot | null {
  const contractId = routedContractId(record.input);

  if (contractId !== query.contractId) {
    return null;
  }

  return createEligibilitySnapshot({
    ...remainingMetadata(record.input, record.observedAt),
    contractId,
    researchOnly: snapshotProperty(
      record.input,
      'researchOnly',
      'researchOnly',
      invalidSnapshot,
    ),
    eligible: snapshotProperty(
      record.input,
      'eligible',
      'eligible',
      invalidSnapshot,
    ),
    reason: snapshotProperty(record.input, 'reason', 'reason', invalidSnapshot),
  } as unknown as EligibilitySnapshotInput);
}

function relevantCostSnapshot(
  record: ObservableRecord,
  query: RiskSnapshotSelectionQuery,
): CostModelSnapshot | null {
  const contractId = routedContractId(record.input);

  if (contractId !== query.contractId) {
    return null;
  }

  return createCostModelSnapshot({
    ...remainingMetadata(record.input, record.observedAt),
    contractId,
    currency: snapshotProperty(
      record.input,
      'currency',
      'currency',
      invalidSnapshot,
    ),
    entryFees: snapshotProperty(
      record.input,
      'entryFees',
      'entryFees',
      invalidSnapshot,
    ),
    exitFees: snapshotProperty(
      record.input,
      'exitFees',
      'exitFees',
      invalidSnapshot,
    ),
    spreadPriceUnitsRoundTrip: snapshotProperty(
      record.input,
      'spreadPriceUnitsRoundTrip',
      'spreadPriceUnitsRoundTrip',
      invalidSnapshot,
    ),
    adverseEntrySlippagePriceUnits: snapshotProperty(
      record.input,
      'adverseEntrySlippagePriceUnits',
      'adverseEntrySlippagePriceUnits',
      invalidSnapshot,
    ),
    adverseExitSlippagePriceUnits: snapshotProperty(
      record.input,
      'adverseExitSlippagePriceUnits',
      'adverseExitSlippagePriceUnits',
      invalidSnapshot,
    ),
  } as unknown as CostModelSnapshotInput);
}

function latestObservable<T extends SnapshotMetadata>(
  view: DenseArrayView,
  decisionAt: InstantString,
  field: string,
  buildRelevant: (record: ObservableRecord) => T | null,
): T | null {
  let selected: T | null = null;
  const seenObservedAt = new Set<InstantString>();

  for (let index = 0; index < view.length; index += 1) {
    const record = observableRecord(view, index, field, decisionAt);

    if (record === null) {
      continue;
    }

    const snapshot = buildRelevant(record);

    if (snapshot === null) {
      continue;
    }

    if (seenObservedAt.has(snapshot.observedAt)) {
      invalidSnapshot('Relevant snapshots must not tie on observedAt.', {
        field,
        observedAt: snapshot.observedAt,
      });
    }
    seenObservedAt.add(snapshot.observedAt);

    if (selected === null) {
      selected = snapshot;
      continue;
    }

    const comparison = Temporal.Instant.compare(
      snapshot.observedAt,
      selected.observedAt,
    );

    if (comparison > 0) {
      selected = snapshot;
    }
  }

  return selected;
}

function assertSelectedCurrency(
  snapshot: MarginSnapshot | CostModelSnapshot | null,
  field: string,
  expected: CurrencyCode,
): void {
  if (snapshot !== null && snapshot.currency !== expected) {
    fail('MISMATCHED_CURRENCY', `${field} must equal pnlCurrency.`, {
      field,
      expected,
      value: snapshot.currency,
    });
  }
}

export function selectRiskSnapshotBundle(
  seriesInput: RiskSnapshotSeriesInput,
  queryInput: RiskSnapshotSelectionQueryInput,
): RiskSnapshotBundle {
  const query = validateQuery(queryInput);
  const series = snapshotSeriesViews(seriesInput);
  const fx =
    query.pnlCurrency === query.accountCurrency
      ? null
      : latestObservable(series.fx, query.decisionAt, 'fx', (record) =>
          relevantFxSnapshot(record, query),
        );
  const margin = latestObservable(
    series.margin,
    query.decisionAt,
    'margin',
    (record) => relevantMarginSnapshot(record, query),
  );
  const eligibility = latestObservable(
    series.eligibility,
    query.decisionAt,
    'eligibility',
    (record) => relevantEligibilitySnapshot(record, query),
  );
  const costs = latestObservable(
    series.costs,
    query.decisionAt,
    'costs',
    (record) => relevantCostSnapshot(record, query),
  );

  assertSelectedCurrency(margin, 'margin.currency', query.pnlCurrency);
  assertSelectedCurrency(costs, 'costs.currency', query.pnlCurrency);

  return Object.freeze({ fx, margin, eligibility, costs });
}
