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
import {
  executionLimitations,
  type ExecutionLimitation,
} from './limitations.js';

export type { ExecutionLimitation } from './limitations.js';

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
  readonly signalDecisionAt: InstantString;
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

export interface ExecuteTrendExitAtNextOpenInput {
  readonly position: Readonly<OpenPosition>;
  readonly intent: Readonly<TrendExitIntent>;
  readonly open: Readonly<H1OpenEvent>;
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
      limitations: readonly ExecutionLimitation[];
    }>
  | Readonly<{
      type: 'POSITION_REMAINS_OPEN';
      positionId: string;
      evaluatedAt: InstantString;
      availableAt: InstantString;
      limitations: readonly ExecutionLimitation[];
    }>;

export type TrendExitIntent = Extract<
  PositionH1BarResult,
  { readonly type: 'TREND_EXIT_INTENT' }
>;

export interface TrendExitFilled {
  readonly type: 'TREND_EXIT_FILLED';
  readonly positionId: string;
  readonly instrumentId: string;
  readonly contractId: string;
  readonly direction: EntryDirection;
  readonly intentOccurredAt: InstantString;
  readonly intentAvailableAt: InstantString;
  readonly occurredAt: InstantString;
  readonly availableAt: InstantString;
  readonly referencePrice: DecimalString;
  readonly kijunPrice: DecimalString;
  readonly fillPrice: DecimalString;
  readonly quantity: DecimalString;
  readonly exitPolicyVersion: string;
  readonly limitations: readonly ExecutionLimitation[];
}

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
  'signalDecisionAt',
  'openedAt',
  'executionModelVersion',
  'exitPolicyVersion',
  'limitations',
] as const);

const filledEntryFields = Object.freeze([
  'intentId',
  'occurredAt',
  'availableAt',
  'fillPrice',
  'quantity',
  'reasons',
  'riskDecision',
  'limitations',
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

const trendExitIntentFields = Object.freeze([
  'type',
  'positionId',
  'occurredAt',
  'availableAt',
  'referencePrice',
  'kijunPrice',
  'quantity',
  'fillModel',
  'exitPolicyVersion',
  'limitations',
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
  const limitations = validatedLimitations(fill.limitations);
  return {
    type,
    ...fill,
    limitations,
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
  const quantity = positiveExecutionDecimal(fill.quantity, 'quantity');
  const riskQuantity = positiveExecutionDecimal(
    fill.riskDecision.quantity,
    'quantity',
  );
  if (!decimalEqual(quantity, riskQuantity)) {
    invalid('quantity', quantity);
  }
  const context = fill.riskDecision.context;
  const economicEntryPrice = positiveExecutionDecimal(
    fill.fillPrice,
    'fillPrice',
  );
  const contextEntryPrice = positiveExecutionDecimal(
    context.entryPrice,
    'entryPrice',
  );
  if (!decimalEqual(economicEntryPrice, contextEntryPrice)) {
    invalid('entryPrice', context.entryPrice);
  }
  const occurredAt = instant(fill.occurredAt, 'occurredAt');
  const availableAt = instant(fill.availableAt, 'availableAt');
  const riskDecisionAt = instant(context.decisionAt, 'decisionAt');
  if (compare(availableAt, occurredAt) < 0) {
    invalid('occurredAt', occurredAt);
  }
  if (compare(availableAt, riskDecisionAt) !== 0) {
    invalid('availableAt', availableAt);
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
  const contextStopPrice = positiveExecutionDecimal(
    context.stopPrice,
    'stopPrice',
  );
  if (!decimalEqual(intent.stopPrice, contextStopPrice)) {
    invalid('stopPrice', context.stopPrice);
  }
  if (
    compare(occurredAt, intent.signalCloseTime) <= 0 ||
    compare(occurredAt, intent.signalDecisionAt) < 0
  ) {
    invalid('occurredAt', occurredAt);
  }

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
    signalDecisionAt: intent.signalDecisionAt,
    openedAt: occurredAt,
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion,
    limitations: executionLimitations,
  });
}

export function snapshotOpenPosition(
  input: unknown,
  limitationsField = 'limitations',
): Readonly<OpenPosition> {
  const value = snapshotFields(input, 'position', publicPositionFields);
  const limitations = validatedLimitations(value.limitations, limitationsField);
  if (value.executionModelVersion !== 'BAR_BASED_H1_V1') {
    invalid('executionModelVersion', value.executionModelVersion);
  }
  if (value.timeframe !== '1h') invalid('timeframe', value.timeframe);
  if (value.direction !== 'LONG' && value.direction !== 'SHORT') {
    invalid('direction', value.direction);
  }
  const positionId = nonBlank(value.positionId, 'positionId');
  const intentId = nonBlank(value.intentId, 'intentId');
  const riskDecisionId = nonBlank(value.riskDecisionId, 'riskDecisionId');
  const instrumentId = nonBlank(value.instrumentId, 'instrumentId');
  const contractId = nonBlank(value.contractId, 'contractId');
  const strategyVersion = nonBlank(value.strategyVersion, 'strategyVersion');
  const datasetVersion = nonBlank(value.datasetVersion, 'datasetVersion');
  const riskPolicyVersion = nonBlank(
    value.riskPolicyVersion,
    'riskPolicyVersion',
  );
  const exitPolicyVersion = nonBlank(
    value.exitPolicyVersion,
    'exitPolicyVersion',
  );
  if (contractId === instrumentId) invalid('contractId', contractId);

  const quantity = positiveExecutionDecimal(value.quantity, 'quantity');
  const economicEntryPrice = positiveExecutionDecimal(
    value.economicEntryPrice,
    'economicEntryPrice',
  );
  const accountingBasisPrice = positiveExecutionDecimal(
    value.accountingBasisPrice,
    'accountingBasisPrice',
  );
  const protectiveStopPrice = positiveExecutionDecimal(
    value.protectiveStopPrice,
    'protectiveStopPrice',
  );
  const entryCostAccountCurrency = nonnegativeExecutionDecimal(
    value.entryCostAccountCurrency,
    'entryCostAccountCurrency',
  );
  const tickSize = positiveExecutionDecimal(value.tickSize, 'tickSize');
  const signalCloseTime = instant(value.signalCloseTime, 'signalCloseTime');
  const signalDecisionAt = instant(value.signalDecisionAt, 'signalDecisionAt');
  const openedAt = instant(value.openedAt, 'openedAt');
  if (compare(signalDecisionAt, signalCloseTime) < 0) {
    invalid('signalDecisionAt', signalDecisionAt);
  }
  if (compare(openedAt, signalDecisionAt) < 0) {
    invalid('openedAt', openedAt);
  }
  if (compare(openedAt, signalCloseTime) <= 0) invalid('openedAt', openedAt);

  const tick = new ExecutionDecimal(tickSize);
  for (const [field, price] of [
    ['economicEntryPrice', economicEntryPrice],
    ['accountingBasisPrice', accountingBasisPrice],
    ['protectiveStopPrice', protectiveStopPrice],
  ] as const) {
    if (!new ExecutionDecimal(price).mod(tick).isZero()) invalid(field, price);
  }
  const entry = new ExecutionDecimal(economicEntryPrice);
  const stop = new ExecutionDecimal(protectiveStopPrice);
  if (
    (value.direction === 'LONG' && !stop.lt(entry)) ||
    (value.direction === 'SHORT' && !stop.gt(entry))
  ) {
    invalid('protectiveStopPrice', protectiveStopPrice);
  }

  return Object.freeze({
    ...value,
    positionId,
    intentId,
    riskDecisionId,
    instrumentId,
    contractId,
    strategyVersion,
    datasetVersion,
    riskPolicyVersion,
    exitPolicyVersion,
    limitations,
    quantity,
    economicEntryPrice,
    accountingBasisPrice,
    protectiveStopPrice,
    entryCostAccountCurrency,
    tickSize,
    signalCloseTime,
    signalDecisionAt,
    openedAt,
  }) as Readonly<OpenPosition>;
}

function validatedLimitations(
  value: unknown,
  field = 'limitations',
): readonly ExecutionLimitation[] {
  let length: number;
  try {
    if (!Array.isArray(value)) invalid(field);
    length = value.length;
  } catch {
    invalid(field);
  }
  if (length !== executionLimitations.length) invalid(field);

  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      invalid(field);
    }
    if (descriptor === undefined || !descriptor.enumerable) invalid(field);
    let item: unknown;
    if ('value' in descriptor) {
      item = descriptor.value;
    } else if (descriptor.get === undefined) {
      item = undefined;
    } else {
      try {
        item = descriptor.get.call(value);
      } catch {
        invalid(field);
      }
    }
    if (item !== executionLimitations[index]) invalid(field);
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

function snapshotTrendExitIntent(input: unknown): TrendExitIntent {
  const value = snapshotFields(input, 'intent', trendExitIntentFields);
  if (value.type !== 'TREND_EXIT_INTENT') invalid('intent', value.type);
  if (value.fillModel !== 'NEXT_TRADABLE_PRICE') {
    invalid('fillModel', value.fillModel);
  }
  const occurredAt = instant(value.occurredAt, 'occurredAt');
  const availableAt = instant(value.availableAt, 'availableAt');
  if (compare(availableAt, occurredAt) < 0) {
    invalid('availableAt', availableAt);
  }
  return Object.freeze({
    type: 'TREND_EXIT_INTENT',
    positionId: nonBlank(value.positionId, 'positionId'),
    occurredAt,
    availableAt,
    referencePrice: positiveExecutionDecimal(
      value.referencePrice,
      'referencePrice',
    ),
    kijunPrice: positiveExecutionDecimal(value.kijunPrice, 'kijunPrice'),
    quantity: positiveExecutionDecimal(value.quantity, 'quantity'),
    fillModel: 'NEXT_TRADABLE_PRICE',
    exitPolicyVersion: nonBlank(value.exitPolicyVersion, 'exitPolicyVersion'),
    limitations: validatedLimitations(value.limitations),
  });
}

export function processPositionH1Bar(
  input: ProcessPositionH1BarInput,
): PositionH1BarResult {
  assertPlainRecord(input, 'input');
  const position = snapshotOpenPosition(ownValue(input, 'position'));
  const openEvent = createH1OpenEvent(
    ownValue(input, 'openEvent') as H1OpenEventInput,
  );
  const decisionAt = instant(ownValue(input, 'decisionAt'), 'decisionAt');
  const adjustment = nonnegativeExecutionDecimal(
    ownValue(input, 'adverseExitSlippagePriceUnits'),
    'adverseExitSlippagePriceUnits',
  );
  const tick = new ExecutionDecimal(position.tickSize);
  if (!new ExecutionDecimal(adjustment).mod(tick).isZero()) {
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
  if (!new ExecutionDecimal(openEvent.price).mod(tick).isZero()) {
    invalid('openEvent.price', openEvent.price);
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

  for (const [field, price] of [
    ['high', bar.high],
    ['low', bar.low],
    ['close', bar.close],
  ] as const) {
    if (!new ExecutionDecimal(price).mod(tick).isZero()) {
      invalid(`bar.${field}`, price);
    }
  }

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
      limitations: executionLimitations,
    });
  }

  return Object.freeze({
    type: 'POSITION_REMAINS_OPEN' as const,
    positionId: position.positionId,
    evaluatedAt: bar.closeTime,
    availableAt: bar.availableAt,
    limitations: executionLimitations,
  });
}

export function executeTrendExitAtNextOpen(
  input: ExecuteTrendExitAtNextOpenInput,
): Readonly<TrendExitFilled> {
  assertPlainRecord(input, 'input');
  const position = snapshotOpenPosition(ownValue(input, 'position'));
  const intent = snapshotTrendExitIntent(ownValue(input, 'intent'));
  const open = createH1OpenEvent(ownValue(input, 'open') as H1OpenEventInput);
  const decisionAt = instant(ownValue(input, 'decisionAt'), 'decisionAt');
  const adjustment = nonnegativeExecutionDecimal(
    ownValue(input, 'adverseExitSlippagePriceUnits'),
    'adverseExitSlippagePriceUnits',
  );

  if (intent.positionId !== position.positionId) {
    invalid('positionId', intent.positionId);
  }
  if (!new ExecutionDecimal(intent.quantity).eq(position.quantity)) {
    invalid('quantity', intent.quantity);
  }
  if (intent.exitPolicyVersion !== position.exitPolicyVersion) {
    invalid('exitPolicyVersion', intent.exitPolicyVersion);
  }
  if (compare(intent.occurredAt, position.openedAt) <= 0) {
    invalid('occurredAt', intent.occurredAt);
  }
  const referencePrice = new ExecutionDecimal(intent.referencePrice);
  const kijunPrice = new ExecutionDecimal(intent.kijunPrice);
  if (
    (position.direction === 'LONG' && !referencePrice.lt(kijunPrice)) ||
    (position.direction === 'SHORT' && !referencePrice.gt(kijunPrice))
  ) {
    invalid('referencePrice', intent.referencePrice);
  }
  if (open.instrumentId !== position.instrumentId) {
    invalid('instrumentId', open.instrumentId);
  }
  if (open.contractId !== position.contractId) {
    invalid('contractId', open.contractId);
  }
  if (
    compare(open.openTime, intent.occurredAt) <= 0 ||
    compare(open.openTime, intent.availableAt) < 0
  ) {
    invalid('openTime', open.openTime);
  }
  if (
    compare(intent.availableAt, decisionAt) > 0 ||
    compare(open.availableAt, decisionAt) > 0
  ) {
    invalid('decisionAt', decisionAt);
  }

  const tick = new ExecutionDecimal(position.tickSize);
  if (!new ExecutionDecimal(intent.referencePrice).mod(tick).isZero()) {
    invalid('referencePrice', intent.referencePrice);
  }
  if (!new ExecutionDecimal(open.price).mod(tick).isZero()) {
    invalid('open.price', open.price);
  }
  if (!new ExecutionDecimal(adjustment).mod(tick).isZero()) {
    invalid('adverseExitSlippagePriceUnits', adjustment);
  }
  const fillPrice = adjustedExitPrice(position, open.price, adjustment);

  return Object.freeze({
    type: 'TREND_EXIT_FILLED',
    positionId: position.positionId,
    instrumentId: position.instrumentId,
    contractId: position.contractId,
    direction: position.direction,
    intentOccurredAt: intent.occurredAt,
    intentAvailableAt: intent.availableAt,
    occurredAt: open.openTime,
    availableAt: open.availableAt,
    referencePrice: intent.referencePrice,
    kijunPrice: intent.kijunPrice,
    fillPrice,
    quantity: position.quantity,
    exitPolicyVersion: position.exitPolicyVersion,
    limitations: executionLimitations,
  });
}
