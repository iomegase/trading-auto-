import {
  asDecimalString,
  asInstantString,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import {
  evaluateOrderRisk,
  type OrderRiskInput,
  type RiskDecision,
  type RiskDecisionReason,
} from '@trading-auto/risk';
import { Temporal } from '@js-temporal/polyfill';

import {
  createH1OpenEvent,
  type H1OpenEvent,
  type H1OpenEventInput,
} from './bar-events.js';
import {
  ExecutionDecimal,
  nonnegativeExecutionDecimal,
  positiveExecutionDecimal,
} from './decimal.js';
import { ExecutionInputError } from './errors.js';

export type EntryDirection = 'LONG' | 'SHORT';
export type ApprovedRiskDecisionStatus = 'APPROVE' | 'REDUCE_SIZE';

export interface EntryIntentInput {
  intentId: string;
  instrumentId: string;
  contractId: string;
  strategyVersion: string;
  datasetVersion: string;
  timeframe: string;
  direction: string;
  signalCloseTime: string;
  expiresAt: string;
  stopPrice: string;
  requestedQuantity: string;
  riskDecisionId: string;
  riskDecisionStatus: string;
}

export interface EntryIntent {
  readonly intentId: string;
  readonly instrumentId: string;
  readonly contractId: string;
  readonly strategyVersion: string;
  readonly datasetVersion: string;
  readonly timeframe: '1h';
  readonly direction: EntryDirection;
  readonly signalCloseTime: InstantString;
  readonly expiresAt: InstantString;
  readonly stopPrice: DecimalString;
  readonly requestedQuantity: DecimalString;
  readonly riskDecisionId: string;
  readonly riskDecisionStatus: ApprovedRiskDecisionStatus;
}

export interface ExecuteEntryAtNextOpenInput {
  readonly intent: Readonly<EntryIntent>;
  readonly open: Readonly<H1OpenEvent>;
  readonly adverseEntrySlippagePriceUnits: string;
  readonly riskInput: Readonly<OrderRiskInput>;
}

type ExecutionCancellationReason = RiskDecisionReason | 'INVALID_STOP_AT_OPEN';

export type EntryExecutionResult =
  | Readonly<{
      type: 'ENTRY_FILLED' | 'ENTRY_REDUCED_AND_FILLED';
      intentId: string;
      occurredAt: InstantString;
      availableAt: InstantString;
      fillPrice: DecimalString;
      quantity: DecimalString;
      reasons: readonly RiskDecisionReason[];
      riskDecision: RiskDecision;
    }>
  | Readonly<{
      type: 'ENTRY_CANCELLED';
      intentId: string;
      occurredAt: InstantString;
      availableAt: InstantString;
      quantity: DecimalString;
      reasons: readonly ExecutionCancellationReason[];
      riskDecision: RiskDecision | null;
    }>;

export type FilledEntryExecution = Extract<
  EntryExecutionResult,
  { readonly type: 'ENTRY_FILLED' | 'ENTRY_REDUCED_AND_FILLED' }
>;

const intentFields = Object.freeze([
  'intentId',
  'instrumentId',
  'contractId',
  'strategyVersion',
  'datasetVersion',
  'timeframe',
  'direction',
  'signalCloseTime',
  'expiresAt',
  'stopPrice',
  'requestedQuantity',
  'riskDecisionId',
  'riskDecisionStatus',
] as const);

type IntentField = (typeof intentFields)[number];

const requiredRiskFields = Object.freeze([
  'instrumentId',
  'direction',
  'riskPolicyUseMode',
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
] as const satisfies readonly (keyof OrderRiskInput)[]);

const optionalRiskFields = Object.freeze([
  'backtestId',
  'runCreatedAt',
] as const satisfies readonly (keyof OrderRiskInput)[]);

const productFields = Object.freeze([
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
] as const);

const contractFields = Object.freeze([
  'contractId',
  'productCode',
  'firstTradeAt',
  'lastTradeAt',
  'expiryAt',
  'settlementType',
] as const);

function invalid(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_INPUT',
    `${field} is invalid for entry execution.`,
    { field, value },
  );
}

function assertPlainRecord(
  value: unknown,
  field: string,
): asserts value is object {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid(field);
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) invalid(field);
  } catch {
    invalid(field);
  }
}

function descriptorValue(
  input: object,
  field: string,
  required: boolean,
): { readonly present: boolean; readonly value: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, field);
  } catch {
    invalid(field);
  }
  if (descriptor === undefined) {
    if (required) invalid(field);
    return { present: false, value: undefined };
  }
  if (!descriptor.enumerable) invalid(field);
  if ('value' in descriptor) return { present: true, value: descriptor.value };
  if (descriptor.get === undefined) {
    return { present: true, value: undefined };
  }
  try {
    return { present: true, value: descriptor.get.call(input) };
  } catch {
    invalid(field);
  }
}

function ownValue(input: object, field: string): unknown {
  return descriptorValue(input, field, true).value;
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(field, value);
  }
  return value;
}

function instant(value: unknown, field: string): InstantString {
  if (typeof value !== 'string') invalid(field, value);
  try {
    return asInstantString(value);
  } catch {
    invalid(field, value);
  }
}

function compare(left: InstantString, right: InstantString): number {
  return Temporal.Instant.compare(left, right);
}

export function createEntryIntent(input: EntryIntentInput): EntryIntent {
  assertPlainRecord(input, 'input');
  const values = Object.create(null) as Record<IntentField, unknown>;
  for (const field of intentFields) values[field] = ownValue(input, field);

  const intentId = nonBlank(values.intentId, 'intentId');
  const instrumentId = nonBlank(values.instrumentId, 'instrumentId');
  const contractId = nonBlank(values.contractId, 'contractId');
  const strategyVersion = nonBlank(values.strategyVersion, 'strategyVersion');
  const datasetVersion = nonBlank(values.datasetVersion, 'datasetVersion');
  const riskDecisionId = nonBlank(values.riskDecisionId, 'riskDecisionId');
  if (contractId === instrumentId) invalid('contractId', contractId);
  if (values.timeframe !== '1h') invalid('timeframe', values.timeframe);
  if (values.direction !== 'LONG' && values.direction !== 'SHORT') {
    invalid('direction', values.direction);
  }
  if (
    values.riskDecisionStatus !== 'APPROVE' &&
    values.riskDecisionStatus !== 'REDUCE_SIZE'
  ) {
    invalid('riskDecisionStatus', values.riskDecisionStatus);
  }
  const signalCloseTime = instant(values.signalCloseTime, 'signalCloseTime');
  const expiresAt = instant(values.expiresAt, 'expiresAt');
  if (compare(signalCloseTime, expiresAt) >= 0) invalid('expiresAt', expiresAt);
  const stopPrice = positiveExecutionDecimal(values.stopPrice, 'stopPrice');
  const requestedQuantity = positiveExecutionDecimal(
    values.requestedQuantity,
    'requestedQuantity',
  );

  return Object.freeze({
    intentId,
    instrumentId,
    contractId,
    strategyVersion,
    datasetVersion,
    timeframe: values.timeframe,
    direction: values.direction,
    signalCloseTime,
    expiresAt,
    stopPrice,
    requestedQuantity,
    riskDecisionId,
    riskDecisionStatus: values.riskDecisionStatus,
  });
}

function zero(): DecimalString {
  return asDecimalString('0');
}

function cancelled(
  intent: EntryIntent,
  occurredAt: InstantString,
  availableAt: InstantString,
  reasons: readonly ExecutionCancellationReason[],
  riskDecision: RiskDecision | null,
): EntryExecutionResult {
  return Object.freeze({
    type: 'ENTRY_CANCELLED' as const,
    intentId: intent.intentId,
    occurredAt,
    availableAt,
    quantity: zero(),
    reasons: Object.freeze([...reasons]),
    riskDecision,
  });
}

function snapshotRiskInput(input: unknown): OrderRiskInput {
  assertPlainRecord(input, 'riskInput');
  const snapshot: Record<string, unknown> = {};
  for (const field of requiredRiskFields) {
    snapshot[field] = ownValue(input, field);
  }
  if (snapshot.riskPolicyUseMode !== 'FORWARD') {
    snapshot.riskPolicyUseAt = ownValue(input, 'riskPolicyUseAt');
    for (const field of optionalRiskFields) {
      const captured = descriptorValue(input, field, false);
      if (captured.present) snapshot[field] = captured.value;
    }
  }
  snapshot.product = snapshotRecordFields(
    snapshot.product,
    'product',
    productFields,
  );
  snapshot.contract = snapshotRecordFields(
    snapshot.contract,
    'contract',
    contractFields,
  );
  return snapshot as unknown as OrderRiskInput;
}

function snapshotRecordFields(
  input: unknown,
  field: string,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  assertPlainRecord(input, field);
  const snapshot: Record<string, unknown> = {};
  for (const nestedField of fields) {
    snapshot[nestedField] = ownValue(input, nestedField);
  }
  return Object.freeze(snapshot);
}

function nestedIdentity(input: unknown, field: string): string {
  assertPlainRecord(input, field);
  return nonBlank(ownValue(input, field), field);
}

function exactFillPrice(
  direction: EntryDirection,
  openPrice: DecimalString,
  adjustment: DecimalString,
): DecimalString {
  const open = new ExecutionDecimal(openPrice);
  const delta = new ExecutionDecimal(adjustment);
  const result = direction === 'LONG' ? open.plus(delta) : open.minus(delta);
  if (!result.isFinite() || !result.gt(0)) invalid('fillPrice');
  return positiveExecutionDecimal(result.toFixed(), 'fillPrice');
}

export function executeEntryAtNextOpen(
  input: ExecuteEntryAtNextOpenInput,
): EntryExecutionResult {
  assertPlainRecord(input, 'input');
  const intent = createEntryIntent(
    ownValue(input, 'intent') as EntryIntentInput,
  );
  const open = createH1OpenEvent(ownValue(input, 'open') as H1OpenEventInput);
  const adjustment = nonnegativeExecutionDecimal(
    ownValue(input, 'adverseEntrySlippagePriceUnits'),
    'adverseEntrySlippagePriceUnits',
  );
  const rawRiskInput = ownValue(input, 'riskInput');

  if (open.instrumentId !== intent.instrumentId) {
    invalid('instrumentId', open.instrumentId);
  }
  if (open.contractId !== intent.contractId)
    invalid('contractId', open.contractId);
  if (compare(open.openTime, intent.signalCloseTime) <= 0) {
    invalid('openTime', open.openTime);
  }
  if (compare(open.availableAt, intent.expiresAt) >= 0) {
    return cancelled(
      intent,
      open.openTime,
      open.availableAt,
      ['SIGNAL_EXPIRED'],
      null,
    );
  }

  const fillPrice = exactFillPrice(intent.direction, open.price, adjustment);
  const fill = new ExecutionDecimal(fillPrice);
  const stop = new ExecutionDecimal(intent.stopPrice);
  if (
    (intent.direction === 'LONG' && !stop.lt(fill)) ||
    (intent.direction === 'SHORT' && !stop.gt(fill))
  ) {
    return cancelled(
      intent,
      open.openTime,
      open.availableAt,
      ['INVALID_STOP_AT_OPEN'],
      null,
    );
  }

  const riskInput = snapshotRiskInput(rawRiskInput);
  if (riskInput.instrumentId !== intent.instrumentId) {
    invalid('instrumentId', riskInput.instrumentId);
  }
  if (riskInput.direction !== intent.direction) {
    invalid('direction', riskInput.direction);
  }
  if (riskInput.strategyVersion !== intent.strategyVersion) {
    invalid('strategyVersion', riskInput.strategyVersion);
  }
  if (riskInput.datasetVersion !== intent.datasetVersion) {
    invalid('datasetVersion', riskInput.datasetVersion);
  }
  const signalExpiresAt = instant(riskInput.signalExpiresAt, 'signalExpiresAt');
  if (compare(signalExpiresAt, intent.expiresAt) !== 0) {
    invalid('signalExpiresAt', signalExpiresAt);
  }
  if (nestedIdentity(riskInput.contract, 'contractId') !== intent.contractId) {
    invalid('contractId');
  }
  if (
    nestedIdentity(riskInput.product, 'productCode') !== intent.instrumentId
  ) {
    invalid('instrumentId');
  }

  const tickSize = positiveExecutionDecimal(
    ownValue(riskInput.product, 'tickSize'),
    'tickSize',
  );
  if (!new ExecutionDecimal(adjustment).mod(tickSize).isZero()) {
    invalid('adverseEntrySlippagePriceUnits', adjustment);
  }

  const riskDecision = evaluateOrderRisk({
    ...riskInput,
    entryPrice: fillPrice,
    stopPrice: intent.stopPrice,
    requestedQuantity: intent.requestedQuantity,
    decisionAt: open.availableAt,
    riskPolicyUseAt:
      riskInput.riskPolicyUseMode === 'FORWARD'
        ? open.availableAt
        : riskInput.riskPolicyUseAt,
    signalExpiresAt,
  });

  if (riskDecision.status === 'REJECT') {
    return cancelled(
      intent,
      open.openTime,
      open.availableAt,
      riskDecision.reasons,
      riskDecision,
    );
  }
  return Object.freeze({
    type:
      riskDecision.status === 'APPROVE'
        ? ('ENTRY_FILLED' as const)
        : ('ENTRY_REDUCED_AND_FILLED' as const),
    intentId: intent.intentId,
    occurredAt: open.openTime,
    availableAt: open.availableAt,
    fillPrice,
    quantity: riskDecision.quantity,
    reasons: Object.freeze([...riskDecision.reasons]),
    riskDecision,
  });
}
