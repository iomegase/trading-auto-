import {
  asInstantString,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import { Temporal } from '@js-temporal/polyfill';

import {
  createH1ClosedBarEvent,
  createH1OpenEvent,
  type H1ClosedBarEvent,
  type H1ClosedBarEventInput,
  type H1OpenEvent,
  type H1OpenEventInput,
} from './bar-events.js';
import {
  ExecutionDecimal,
  nonnegativeExecutionDecimal,
  positiveExecutionDecimal,
} from './decimal.js';
import {
  createEntryIntent,
  type EntryDirection,
  type EntryIntent,
  type EntryIntentInput,
  type FilledEntryExecution,
} from './entry.js';
import { ExecutionInputError } from './errors.js';

export type ExecutionLimitation =
  'NO_INTRABAR_PATH' | 'NO_PARTIAL_FILLS' | 'NO_ORDER_BOOK';

const executionLimitations: readonly ExecutionLimitation[] = Object.freeze([
  'NO_INTRABAR_PATH',
  'NO_PARTIAL_FILLS',
  'NO_ORDER_BOOK',
]);

export interface OpenPositionInput {
  readonly positionId: string;
  readonly intent: Readonly<EntryIntent>;
  readonly fill: Readonly<FilledEntryExecution>;
  readonly entryCostAccountCurrency: string;
  readonly tickSize: string;
  readonly executionModelVersion: string;
  readonly exitPolicyVersion: string;
}

export interface OpenPosition {
  readonly positionId: string;
  readonly intentId: string;
  readonly riskDecisionId: string;
  readonly instrumentId: string;
  readonly contractId: string;
  readonly strategyVersion: string;
  readonly datasetVersion: string;
  readonly riskPolicyVersion: string;
  readonly timeframe: '1h';
  readonly direction: EntryDirection;
  readonly quantity: DecimalString;
  readonly economicEntryPrice: DecimalString;
  readonly accountingBasisPrice: DecimalString;
  readonly protectiveStopPrice: DecimalString;
  readonly entryCostAccountCurrency: DecimalString;
  readonly tickSize: DecimalString;
  readonly signalCloseTime: InstantString;
  readonly openedAt: InstantString;
  readonly executionModelVersion: 'BAR_BASED_H1_V1';
  readonly exitPolicyVersion: string;
  readonly limitations: readonly ExecutionLimitation[];
}

export interface CurrentKijunInput {
  readonly price: string;
  readonly computedAt: string;
}

export interface ProcessPositionH1BarInput {
  readonly position: Readonly<OpenPosition>;
  readonly openEvent: Readonly<H1OpenEvent>;
  readonly bar: Readonly<H1ClosedBarEvent>;
  readonly currentKijun: Readonly<CurrentKijunInput> | null;
  readonly decisionAt: string;
  readonly adverseExitSlippagePriceUnits: string;
}

export type PositionH1BarResult =
  | Readonly<{
      type: 'STOP_GAP_EXIT' | 'PROTECTIVE_STOP_EXIT';
      positionId: string;
      occurredAt: InstantString;
      availableAt: InstantString;
      fillPrice: DecimalString;
      quantity: DecimalString;
      protectiveStopPrice: DecimalString;
      limitations: readonly ExecutionLimitation[];
    }>
  | Readonly<{
      type: 'TREND_EXIT_INTENT';
      positionId: string;
      occurredAt: InstantString;
      availableAt: InstantString;
      referencePrice: DecimalString;
      kijunPrice: DecimalString;
      quantity: DecimalString;
      fillModel: 'NEXT_TRADABLE_PRICE';
      exitPolicyVersion: string;
    }>
  | Readonly<{
      type: 'POSITION_REMAINS_OPEN';
      positionId: string;
      evaluatedAt: InstantString;
      availableAt: InstantString;
    }>;

const positionFields = Object.freeze([
  'positionId',
  'intent',
  'fill',
  'entryCostAccountCurrency',
  'tickSize',
  'executionModelVersion',
  'exitPolicyVersion',
] as const);

const publicPositionFields = Object.freeze([
  'positionId',
  'intentId',
  'riskDecisionId',
  'instrumentId',
  'contractId',
  'strategyVersion',
  'datasetVersion',
  'riskPolicyVersion',
  'timeframe',
  'direction',
  'quantity',
  'economicEntryPrice',
  'accountingBasisPrice',
  'protectiveStopPrice',
  'entryCostAccountCurrency',
  'tickSize',
  'signalCloseTime',
  'openedAt',
  'executionModelVersion',
  'exitPolicyVersion',
  'limitations',
] as const);

const filledEntryFields = Object.freeze([
  'intentId',
  'occurredAt',
  'fillPrice',
  'quantity',
  'reasons',
  'riskDecision',
] as const);

const contextFields = Object.freeze([
  'decisionAt',
  'riskPolicyUseMode',
  'riskPolicyUseAt',
  'backtestId',
  'runCreatedAt',
  'signalExpiresAt',
  'entryPrice',
  'stopPrice',
  'datasetVersion',
  'strategyVersion',
  'riskPolicyVersion',
  'fxVersion',
  'marginVersion',
  'costModelVersion',
  'eligibilityVersion',
  'productCode',
  'contractId',
] as const);

function invalid(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_INPUT',
    `${field} is invalid for the futures position lifecycle.`,
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

function ownValue(input: object, field: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, field);
  } catch {
    invalid(field);
  }
  if (descriptor === undefined || !descriptor.enumerable) invalid(field);
  if ('value' in descriptor) return descriptor.value;
  if (descriptor.get === undefined) return undefined;
  try {
    return descriptor.get.call(input);
  } catch {
    invalid(field);
  }
}

function snapshotFields(
  input: unknown,
  field: string,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  assertPlainRecord(input, field);
  const result: Record<string, unknown> = {};
  for (const nestedField of fields)
    result[nestedField] = ownValue(input, nestedField);
  return Object.freeze(result);
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

function decimalEqual(left: DecimalString, right: unknown): boolean {
  return typeof right === 'string' && new ExecutionDecimal(left).eq(right);
}

function snapshotFilledEntry(input: unknown): FilledEntryExecution {
  assertPlainRecord(input, 'fill');
  const type = ownValue(input, 'type');
  if (type !== 'ENTRY_FILLED' && type !== 'ENTRY_REDUCED_AND_FILLED') {
    invalid('fill', type);
  }
  const fill = snapshotFields(input, 'fill', filledEntryFields);
  const riskDecision = snapshotFields(fill.riskDecision, 'riskDecision', [
    'status',
    'quantity',
    'reasons',
    'economics',
    'context',
  ]);
  if (
    riskDecision.status !== 'APPROVE' &&
    riskDecision.status !== 'REDUCE_SIZE'
  ) {
    invalid('riskDecision', riskDecision.status);
  }
  const context = snapshotFields(
    riskDecision.context,
    'context',
    contextFields,
  );
  return {
    type,
    ...fill,
    riskDecision: { ...riskDecision, context },
  } as unknown as FilledEntryExecution;
}

export function createOpenPosition(input: OpenPositionInput): OpenPosition {
  const raw = snapshotFields(input, 'input', positionFields);
  const positionId = nonBlank(raw.positionId, 'positionId');
  const intent = createEntryIntent(raw.intent as EntryIntentInput);
  const fill = snapshotFilledEntry(raw.fill);
  const entryCostAccountCurrency = nonnegativeExecutionDecimal(
    raw.entryCostAccountCurrency,
    'entryCostAccountCurrency',
  );
  const tickSize = positiveExecutionDecimal(raw.tickSize, 'tickSize');
  if (raw.executionModelVersion !== 'BAR_BASED_H1_V1') {
    invalid('executionModelVersion', raw.executionModelVersion);
  }
  const exitPolicyVersion = nonBlank(
    raw.exitPolicyVersion,
    'exitPolicyVersion',
  );

  if (fill.intentId !== intent.intentId) invalid('intentId', fill.intentId);
  if (!decimalEqual(fill.quantity, fill.riskDecision.quantity)) {
    invalid('quantity', fill.quantity);
  }
  const context = fill.riskDecision.context;
  if (!decimalEqual(fill.fillPrice, context.entryPrice)) {
    invalid('entryPrice', context.entryPrice);
  }
  if (compare(fill.occurredAt, context.decisionAt) !== 0) {
    invalid('occurredAt', fill.occurredAt);
  }
  if (context.strategyVersion !== intent.strategyVersion) {
    invalid('strategyVersion', context.strategyVersion);
  }
  if (context.datasetVersion !== intent.datasetVersion) {
    invalid('datasetVersion', context.datasetVersion);
  }
  if (context.contractId !== intent.contractId) {
    invalid('contractId', context.contractId);
  }
  if (context.productCode !== intent.instrumentId) {
    invalid('productCode', context.productCode);
  }
  if (!decimalEqual(intent.stopPrice, context.stopPrice)) {
    invalid('stopPrice', context.stopPrice);
  }
  if (compare(fill.occurredAt, intent.signalCloseTime) <= 0) {
    invalid('occurredAt', fill.occurredAt);
  }

  const quantity = positiveExecutionDecimal(fill.quantity, 'quantity');
  const economicEntryPrice = positiveExecutionDecimal(
    fill.fillPrice,
    'economicEntryPrice',
  );
  const entry = new ExecutionDecimal(economicEntryPrice);
  const stop = new ExecutionDecimal(intent.stopPrice);
  const tick = new ExecutionDecimal(tickSize);
  if (!entry.mod(tick).isZero()) {
    invalid('economicEntryPrice', economicEntryPrice);
  }
  if (!stop.mod(tick).isZero()) {
    invalid('protectiveStopPrice', intent.stopPrice);
  }
  if (
    (intent.direction === 'LONG' && !stop.lt(entry)) ||
    (intent.direction === 'SHORT' && !stop.gt(entry))
  ) {
    invalid('protectiveStopPrice', intent.stopPrice);
  }

  return Object.freeze({
    positionId,
    intentId: intent.intentId,
    riskDecisionId: intent.riskDecisionId,
    instrumentId: intent.instrumentId,
    contractId: intent.contractId,
    strategyVersion: intent.strategyVersion,
    datasetVersion: intent.datasetVersion,
    riskPolicyVersion: nonBlank(context.riskPolicyVersion, 'riskPolicyVersion'),
    timeframe: '1h',
    direction: intent.direction,
    quantity,
    economicEntryPrice,
    accountingBasisPrice: economicEntryPrice,
    protectiveStopPrice: intent.stopPrice,
    entryCostAccountCurrency,
    tickSize,
    signalCloseTime: intent.signalCloseTime,
    openedAt: instant(fill.occurredAt, 'occurredAt'),
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion,
    limitations: executionLimitations,
  });
}

function snapshotPosition(input: unknown): OpenPosition {
  const value = snapshotFields(input, 'position', publicPositionFields);
  const limitations = validatedLimitations(value.limitations);
  if (value.executionModelVersion !== 'BAR_BASED_H1_V1') {
    invalid('executionModelVersion', value.executionModelVersion);
  }
  if (value.timeframe !== '1h') invalid('timeframe', value.timeframe);
  if (value.direction !== 'LONG' && value.direction !== 'SHORT') {
    invalid('direction', value.direction);
  }
  return {
    ...value,
    limitations,
    quantity: positiveExecutionDecimal(value.quantity, 'quantity'),
    economicEntryPrice: positiveExecutionDecimal(
      value.economicEntryPrice,
      'economicEntryPrice',
    ),
    accountingBasisPrice: positiveExecutionDecimal(
      value.accountingBasisPrice,
      'accountingBasisPrice',
    ),
    protectiveStopPrice: positiveExecutionDecimal(
      value.protectiveStopPrice,
      'protectiveStopPrice',
    ),
    entryCostAccountCurrency: nonnegativeExecutionDecimal(
      value.entryCostAccountCurrency,
      'entryCostAccountCurrency',
    ),
    tickSize: positiveExecutionDecimal(value.tickSize, 'tickSize'),
    signalCloseTime: instant(value.signalCloseTime, 'signalCloseTime'),
    openedAt: instant(value.openedAt, 'openedAt'),
  } as OpenPosition;
}

function validatedLimitations(value: unknown): readonly ExecutionLimitation[] {
  let length: number;
  try {
    if (!Array.isArray(value)) invalid('limitations');
    length = value.length;
  } catch {
    invalid('limitations');
  }
  if (length !== executionLimitations.length) invalid('limitations');

  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      invalid('limitations');
    }
    if (descriptor === undefined || !descriptor.enumerable)
      invalid('limitations');
    let item: unknown;
    if ('value' in descriptor) {
      item = descriptor.value;
    } else if (descriptor.get === undefined) {
      item = undefined;
    } else {
      try {
        item = descriptor.get.call(value);
      } catch {
        invalid('limitations');
      }
    }
    if (item !== executionLimitations[index]) invalid('limitations');
  }
  return executionLimitations;
}

function adjustedExitPrice(
  position: OpenPosition,
  referencePrice: DecimalString,
  adjustment: DecimalString,
): DecimalString {
  const reference = new ExecutionDecimal(referencePrice);
  const delta = new ExecutionDecimal(adjustment);
  const price =
    position.direction === 'LONG'
      ? reference.minus(delta)
      : reference.plus(delta);
  if (!price.isFinite() || !price.gt(0)) invalid('fillPrice');
  return positiveExecutionDecimal(price.toFixed(), 'fillPrice');
}

function stopEvent(
  type: 'STOP_GAP_EXIT' | 'PROTECTIVE_STOP_EXIT',
  position: OpenPosition,
  occurredAt: InstantString,
  availableAt: InstantString,
  referencePrice: DecimalString,
  adjustment: DecimalString,
): PositionH1BarResult {
  return Object.freeze({
    type,
    positionId: position.positionId,
    occurredAt,
    availableAt,
    fillPrice: adjustedExitPrice(position, referencePrice, adjustment),
    quantity: position.quantity,
    protectiveStopPrice: position.protectiveStopPrice,
    limitations: executionLimitations,
  });
}

function currentKijun(
  value: unknown,
  bar: H1ClosedBarEvent,
  decisionAt: InstantString,
): Readonly<{ price: DecimalString; computedAt: InstantString }> {
  if (value === null) invalid('currentKijun');
  const captured = snapshotFields(value, 'currentKijun', [
    'price',
    'computedAt',
  ]);
  const price = positiveExecutionDecimal(captured.price, 'currentKijun.price');
  const computedAt = instant(captured.computedAt, 'currentKijun.computedAt');
  if (
    compare(computedAt, bar.closeTime) < 0 ||
    compare(computedAt, bar.availableAt) < 0 ||
    compare(computedAt, decisionAt) > 0
  ) {
    invalid('currentKijun.computedAt', computedAt);
  }
  return Object.freeze({ price, computedAt });
}

export function processPositionH1Bar(
  input: ProcessPositionH1BarInput,
): PositionH1BarResult {
  assertPlainRecord(input, 'input');
  const position = snapshotPosition(ownValue(input, 'position'));
  const openEvent = createH1OpenEvent(
    ownValue(input, 'openEvent') as H1OpenEventInput,
  );
  const decisionAt = instant(ownValue(input, 'decisionAt'), 'decisionAt');
  const adjustment = nonnegativeExecutionDecimal(
    ownValue(input, 'adverseExitSlippagePriceUnits'),
    'adverseExitSlippagePriceUnits',
  );
  if (!new ExecutionDecimal(adjustment).mod(position.tickSize).isZero()) {
    invalid('adverseExitSlippagePriceUnits', adjustment);
  }
  if (openEvent.instrumentId !== position.instrumentId) {
    invalid('instrumentId', openEvent.instrumentId);
  }
  if (openEvent.contractId !== position.contractId) {
    invalid('contractId', openEvent.contractId);
  }
  if (compare(openEvent.openTime, position.openedAt) < 0) {
    invalid('bar.openTime', openEvent.openTime);
  }
  if (compare(openEvent.availableAt, decisionAt) > 0) {
    invalid('decisionAt', decisionAt);
  }

  const open = new ExecutionDecimal(openEvent.price);
  const stop = new ExecutionDecimal(position.protectiveStopPrice);
  const gapHit =
    position.direction === 'LONG' ? open.lte(stop) : open.gte(stop);
  if (gapHit) {
    return stopEvent(
      'STOP_GAP_EXIT',
      position,
      openEvent.openTime,
      openEvent.availableAt,
      openEvent.price,
      adjustment,
    );
  }

  const bar = createH1ClosedBarEvent(
    ownValue(input, 'bar') as H1ClosedBarEventInput,
  );
  if (bar.instrumentId !== position.instrumentId) {
    invalid('instrumentId', bar.instrumentId);
  }
  if (bar.contractId !== position.contractId)
    invalid('contractId', bar.contractId);
  if (
    compare(bar.openTime, openEvent.openTime) !== 0 ||
    !new ExecutionDecimal(bar.open).eq(openEvent.price)
  ) {
    invalid('bar.openTime', bar.openTime);
  }
  if (compare(bar.availableAt, decisionAt) > 0)
    invalid('decisionAt', decisionAt);

  const high = new ExecutionDecimal(bar.high);
  const low = new ExecutionDecimal(bar.low);

  const intrabarHit =
    position.direction === 'LONG' ? low.lte(stop) : high.gte(stop);
  if (intrabarHit) {
    return stopEvent(
      'PROTECTIVE_STOP_EXIT',
      position,
      bar.closeTime,
      bar.availableAt,
      position.protectiveStopPrice,
      adjustment,
    );
  }

  const kijun = currentKijun(ownValue(input, 'currentKijun'), bar, decisionAt);
  const close = new ExecutionDecimal(bar.close);
  const line = new ExecutionDecimal(kijun.price);
  const trendExit =
    position.direction === 'LONG' ? close.lt(line) : close.gt(line);
  if (trendExit) {
    return Object.freeze({
      type: 'TREND_EXIT_INTENT' as const,
      positionId: position.positionId,
      occurredAt: bar.closeTime,
      availableAt: bar.availableAt,
      referencePrice: bar.close,
      kijunPrice: kijun.price,
      quantity: position.quantity,
      fillModel: 'NEXT_TRADABLE_PRICE' as const,
      exitPolicyVersion: position.exitPolicyVersion,
    });
  }

  return Object.freeze({
    type: 'POSITION_REMAINS_OPEN' as const,
    positionId: position.positionId,
    evaluatedAt: bar.closeTime,
    availableAt: bar.availableAt,
  });
}
