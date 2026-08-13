import {
  asInstantString,
  type DecimalString,
  type FuturesContract,
  type InstantString,
} from '@trading-auto/domain';
import type { OrderRiskInput, RiskDecisionReason } from '@trading-auto/risk';
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
  signedExecutionDecimal,
} from './decimal.js';
import {
  createEntryIntent,
  executeEntryAtNextOpen,
  type EntryExecutionResult,
} from './entry.js';
import { ExecutionInputError } from './errors.js';
import {
  createOpenPosition,
  type ExecutionLimitation,
  type OpenPosition,
} from './position.js';

const MAX_ROLL_ENTRIES = 256;
const MAX_CONTRACTS = 256;

export interface RollScheduleEntryInput {
  fromContractId: string;
  toContractId: string;
  rollAt: string;
}

export interface RollScheduleEntry {
  readonly version: string;
  readonly source: string;
  readonly observedAt: InstantString;
  readonly fromContractId: string;
  readonly toContractId: string;
  readonly rollAt: InstantString;
}

export interface RollScheduleInput {
  version: string;
  source: string;
  observedAt: string;
  entries: readonly RollScheduleEntryInput[];
}

export interface RollSchedule {
  readonly version: string;
  readonly source: string;
  readonly observedAt: InstantString;
  readonly entries: readonly Readonly<RollScheduleEntry>[];
}

export interface RolloverReentryInput {
  readonly positionId: string;
  readonly intentId: string;
  readonly riskDecisionId: string;
  readonly expiresAt: string;
  readonly stopPrice: string;
  readonly stopPolicyVersion: string;
  readonly stopComputedAt: string;
  readonly requestedQuantity: string;
  readonly open: Readonly<H1OpenEvent>;
  readonly adverseEntrySlippagePriceUnits: string;
  readonly entryCostAccountCurrency: string;
  readonly riskInput: Readonly<OrderRiskInput>;
}

export interface ExecuteContractRolloverInput {
  readonly position: Readonly<OpenPosition>;
  readonly roll: Readonly<RollScheduleEntry>;
  readonly decisionAt: string;
  readonly exitOpen: Readonly<H1OpenEvent>;
  readonly adverseExitSlippagePriceUnits: string;
  readonly exitCostsAccountCurrency: string;
  readonly monetaryValuePerPriceUnitAccountCurrency: string;
  readonly reentry: Readonly<RolloverReentryInput>;
}

export interface RolloverExit {
  readonly type: 'ROLLOVER_EXIT';
  readonly positionId: string;
  readonly contractId: string;
  readonly rollScheduleVersion: string;
  readonly rollScheduleSource: string;
  readonly rollScheduleObservedAt: InstantString;
  readonly occurredAt: InstantString;
  readonly availableAt: InstantString;
  readonly fillPrice: DecimalString;
  readonly quantity: DecimalString;
  readonly grossTradePnlAccountCurrency: DecimalString;
  readonly exitCostsAccountCurrency: DecimalString;
  readonly netTradePnlAccountCurrency: DecimalString;
  readonly accountingCashChangeAccountCurrency: DecimalString;
}

export type ContractRolloverResult =
  | Readonly<{
      type: 'ROLLOVER_REENTERED';
      exit: Readonly<RolloverExit>;
      reentry: Exclude<
        EntryExecutionResult,
        { readonly type: 'ENTRY_CANCELLED' }
      >;
      position: Readonly<OpenPosition>;
    }>
  | Readonly<{
      type: 'ROLLOVER_EXITED_FLAT';
      exit: Readonly<RolloverExit>;
      reentry: Extract<
        EntryExecutionResult,
        { readonly type: 'ENTRY_CANCELLED' }
      >;
      position: null;
      reasons:
        readonly RiskDecisionReason[] | readonly ['INVALID_STOP_AT_OPEN'];
    }>;

const entryInputFields = Object.freeze([
  'fromContractId',
  'toContractId',
  'rollAt',
] as const);

const entryFields = Object.freeze([
  'version',
  'source',
  'observedAt',
  ...entryInputFields,
] as const);

const contractFields = Object.freeze([
  'contractId',
  'productCode',
  'firstTradeAt',
  'lastTradeAt',
] as const);

const positionFields = Object.freeze([
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

const reentryFields = Object.freeze([
  'positionId',
  'intentId',
  'riskDecisionId',
  'expiresAt',
  'stopPrice',
  'stopPolicyVersion',
  'stopComputedAt',
  'requestedQuantity',
  'open',
  'adverseEntrySlippagePriceUnits',
  'entryCostAccountCurrency',
  'riskInput',
] as const);

function invalid(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_INPUT',
    `${field} is invalid for explicit futures rollover.`,
    { field, value },
  );
}

function scheduleError(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_EXECUTION_SCHEDULE',
    `${field} is invalid for the versioned roll schedule.`,
    { field, value },
  );
}

function dataError(field: string, value?: unknown): never {
  throw new ExecutionInputError(
    'INVALID_DATA',
    `${field} is unavailable for explicit futures rollover.`,
    { field, value },
  );
}

type Failure = (field: string, value?: unknown) => never;

function assertPlainRecord(
  value: unknown,
  field: string,
  fail: Failure = invalid,
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
  fail: Failure = invalid,
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
  fail: Failure = invalid,
): Readonly<Record<string, unknown>> {
  assertPlainRecord(value, field, fail);
  const result: Record<string, unknown> = {};
  for (const nested of fields) result[nested] = ownValue(value, nested, fail);
  return Object.freeze(result);
}

function denseArray(
  value: unknown,
  field: string,
  maximum: number,
  fail: Failure,
): readonly unknown[] {
  let length: number;
  try {
    if (!Array.isArray(value)) fail(field);
    length = value.length;
  } catch {
    fail(field);
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    fail(field, { length, maximum });
  }
  const result: unknown[] = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      fail(field, { index });
    }
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      fail(field, { index });
    }
    result[index] = descriptor.value;
  }
  return result;
}

function nonBlank(
  value: unknown,
  field: string,
  fail: Failure = invalid,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(field, value);
  }
  return value;
}

function instant(
  value: unknown,
  field: string,
  fail: Failure = invalid,
): InstantString {
  if (typeof value !== 'string') fail(field, value);
  try {
    return asInstantString(value);
  } catch {
    fail(field, value);
  }
}

function compare(left: InstantString, right: InstantString): number {
  return Temporal.Instant.compare(left, right);
}

interface ContractWindow {
  readonly contractId: string;
  readonly productCode: string;
  readonly firstTradeAt: InstantString;
  readonly lastTradeAt: InstantString;
}

function contractWindows(value: unknown): ReadonlyMap<string, ContractWindow> {
  const inputs = denseArray(value, 'contracts', MAX_CONTRACTS, scheduleError);
  const result = new Map<string, ContractWindow>();
  for (const input of inputs) {
    const raw = snapshot(input, 'contracts', contractFields, scheduleError);
    const contractId = nonBlank(raw.contractId, 'contracts', scheduleError);
    if (result.has(contractId)) scheduleError('contracts', contractId);
    const window = Object.freeze({
      contractId,
      productCode: nonBlank(raw.productCode, 'contracts', scheduleError),
      firstTradeAt: instant(raw.firstTradeAt, 'contracts', scheduleError),
      lastTradeAt: instant(raw.lastTradeAt, 'contracts', scheduleError),
    });
    if (compare(window.firstTradeAt, window.lastTradeAt) >= 0) {
      scheduleError('contracts', contractId);
    }
    result.set(contractId, window);
  }
  return result;
}

function activeAt(contract: ContractWindow, at: InstantString): boolean {
  return (
    compare(contract.firstTradeAt, at) <= 0 &&
    compare(at, contract.lastTradeAt) < 0
  );
}

function rollEntryInput(
  value: unknown,
  fail: Failure = scheduleError,
): Readonly<RollScheduleEntryInput & { readonly rollAt: InstantString }> {
  const raw = snapshot(value, 'entries', entryInputFields, fail);
  const fromContractId = nonBlank(raw.fromContractId, 'entries', fail);
  const toContractId = nonBlank(raw.toContractId, 'entries', fail);
  if (fromContractId === toContractId) fail('entries', fromContractId);
  return Object.freeze({
    fromContractId,
    toContractId,
    rollAt: instant(raw.rollAt, 'rollAt', fail),
  });
}

function rollEntry(
  value: unknown,
  fail: Failure = invalid,
): Readonly<RollScheduleEntry> {
  const raw = snapshot(value, 'roll', entryFields, fail);
  const entry = rollEntryInput(raw, fail);
  return Object.freeze({
    version: nonBlank(raw.version, 'version', fail),
    source: nonBlank(raw.source, 'source', fail),
    observedAt: instant(raw.observedAt, 'observedAt', fail),
    ...entry,
  });
}

export function createRollSchedule(
  input: RollScheduleInput,
  contracts: readonly Readonly<FuturesContract>[],
): Readonly<RollSchedule> {
  assertPlainRecord(input, 'input', scheduleError);
  const version = nonBlank(
    ownValue(input, 'version', scheduleError),
    'version',
    scheduleError,
  );
  const source = nonBlank(
    ownValue(input, 'source', scheduleError),
    'source',
    scheduleError,
  );
  const observedAt = instant(
    ownValue(input, 'observedAt', scheduleError),
    'observedAt',
    scheduleError,
  );
  const rawEntries = denseArray(
    ownValue(input, 'entries', scheduleError),
    'entries',
    MAX_ROLL_ENTRIES,
    scheduleError,
  );
  const windows = contractWindows(contracts);
  const entries: Array<Readonly<RollScheduleEntry>> = [];

  for (let index = 0; index < rawEntries.length; index += 1) {
    const inputEntry = rollEntryInput(rawEntries[index]);
    const entry: Readonly<RollScheduleEntry> = Object.freeze({
      version,
      source,
      observedAt,
      ...inputEntry,
    });
    const from = windows.get(entry.fromContractId);
    const to = windows.get(entry.toContractId);
    if (from === undefined || to === undefined) scheduleError('contracts');
    if (from.productCode !== to.productCode) scheduleError('contracts');
    if (!activeAt(from, entry.rollAt) || !activeAt(to, entry.rollAt)) {
      scheduleError('rollAt', entry.rollAt);
    }
    if (compare(observedAt, entry.rollAt) > 0) {
      scheduleError('observedAt', observedAt);
    }
    const previous = entries[index - 1];
    if (
      previous !== undefined &&
      (previous.toContractId !== entry.fromContractId ||
        compare(previous.rollAt, entry.rollAt) >= 0)
    ) {
      scheduleError('entries', { index });
    }
    entries.push(entry);
  }

  return Object.freeze({
    version,
    source,
    observedAt,
    entries: Object.freeze(entries),
  });
}

function limitations(value: unknown): readonly ExecutionLimitation[] {
  const items = denseArray(value, 'limitations', 3, invalid);
  const expected = [
    'NO_INTRABAR_PATH',
    'NO_PARTIAL_FILLS',
    'NO_ORDER_BOOK',
  ] as const;
  if (
    items.length !== expected.length ||
    items.some((item, index) => item !== expected[index])
  ) {
    invalid('limitations');
  }
  return Object.freeze([...expected]);
}

function position(value: unknown): OpenPosition {
  const raw = snapshot(value, 'position', positionFields);
  if (raw.direction !== 'LONG' && raw.direction !== 'SHORT') {
    invalid('direction', raw.direction);
  }
  if (raw.timeframe !== '1h') invalid('timeframe', raw.timeframe);
  if (raw.executionModelVersion !== 'BAR_BASED_H1_V1') {
    invalid('executionModelVersion', raw.executionModelVersion);
  }
  return Object.freeze({
    ...raw,
    positionId: nonBlank(raw.positionId, 'positionId'),
    instrumentId: nonBlank(raw.instrumentId, 'instrumentId'),
    contractId: nonBlank(raw.contractId, 'contractId'),
    strategyVersion: nonBlank(raw.strategyVersion, 'strategyVersion'),
    datasetVersion: nonBlank(raw.datasetVersion, 'datasetVersion'),
    direction: raw.direction,
    quantity: positiveExecutionDecimal(raw.quantity, 'quantity'),
    economicEntryPrice: positiveExecutionDecimal(
      raw.economicEntryPrice,
      'economicEntryPrice',
    ),
    accountingBasisPrice: positiveExecutionDecimal(
      raw.accountingBasisPrice,
      'accountingBasisPrice',
    ),
    protectiveStopPrice: positiveExecutionDecimal(
      raw.protectiveStopPrice,
      'protectiveStopPrice',
    ),
    entryCostAccountCurrency: nonnegativeExecutionDecimal(
      raw.entryCostAccountCurrency,
      'entryCostAccountCurrency',
    ),
    tickSize: positiveExecutionDecimal(raw.tickSize, 'tickSize'),
    signalCloseTime: instant(raw.signalCloseTime, 'signalCloseTime'),
    openedAt: instant(raw.openedAt, 'openedAt'),
    limitations: limitations(raw.limitations),
  }) as unknown as OpenPosition;
}

function adjustedExitPrice(
  current: OpenPosition,
  price: DecimalString,
  adjustment: DecimalString,
): DecimalString {
  const reference = new ExecutionDecimal(price);
  const delta = new ExecutionDecimal(adjustment);
  const adjusted =
    current.direction === 'LONG'
      ? reference.minus(delta)
      : reference.plus(delta);
  if (!adjusted.gt(0) || !adjusted.isFinite()) invalid('fillPrice');
  return positiveExecutionDecimal(adjusted.toFixed(), 'fillPrice');
}

function signedOutput(
  value: InstanceType<typeof ExecutionDecimal>,
  field: string,
): DecimalString {
  if (!value.isFinite()) invalid(field);
  return signedExecutionDecimal(value.toFixed(), field);
}

function buildExit(
  current: OpenPosition,
  roll: RollScheduleEntry,
  open: H1OpenEvent,
  adjustment: DecimalString,
  exitCosts: DecimalString,
  monetaryValue: DecimalString,
): Readonly<RolloverExit> {
  const fillPrice = adjustedExitPrice(current, open.price, adjustment);
  const fill = new ExecutionDecimal(fillPrice);
  const economicEntry = new ExecutionDecimal(current.economicEntryPrice);
  const accountingBasis = new ExecutionDecimal(current.accountingBasisPrice);
  const quantity = new ExecutionDecimal(current.quantity);
  const value = new ExecutionDecimal(monetaryValue);
  const direction = current.direction === 'LONG' ? 1 : -1;
  const gross = fill
    .minus(economicEntry)
    .times(direction)
    .times(value)
    .times(quantity);
  const accounting = fill
    .minus(accountingBasis)
    .times(direction)
    .times(value)
    .times(quantity)
    .minus(exitCosts);
  const net = gross.minus(current.entryCostAccountCurrency).minus(exitCosts);
  return Object.freeze({
    type: 'ROLLOVER_EXIT',
    positionId: current.positionId,
    contractId: current.contractId,
    rollScheduleVersion: roll.version,
    rollScheduleSource: roll.source,
    rollScheduleObservedAt: roll.observedAt,
    occurredAt: open.openTime,
    availableAt: open.availableAt,
    fillPrice,
    quantity: current.quantity,
    grossTradePnlAccountCurrency: signedOutput(
      gross,
      'grossTradePnlAccountCurrency',
    ),
    exitCostsAccountCurrency: exitCosts,
    netTradePnlAccountCurrency: signedOutput(net, 'netTradePnlAccountCurrency'),
    accountingCashChangeAccountCurrency: signedOutput(
      accounting,
      'accountingCashChangeAccountCurrency',
    ),
  });
}

export function executeContractRollover(
  input: ExecuteContractRolloverInput,
): ContractRolloverResult {
  assertPlainRecord(input, 'input');
  const current = position(ownValue(input, 'position'));
  const roll = rollEntry(ownValue(input, 'roll'), invalid);
  const decisionAt = instant(ownValue(input, 'decisionAt'), 'decisionAt');
  if (
    compare(roll.rollAt, decisionAt) > 0 ||
    compare(roll.observedAt, roll.rollAt) > 0 ||
    compare(roll.observedAt, decisionAt) > 0
  ) {
    dataError('roll', roll.rollAt);
  }
  if (roll.fromContractId !== current.contractId) {
    invalid('contractId', roll.fromContractId);
  }
  if (current.contractId === current.instrumentId) {
    invalid('contractId', current.contractId);
  }
  if (roll.toContractId === current.instrumentId) {
    invalid('contractId', roll.toContractId);
  }

  const exitOpen = createH1OpenEvent(
    ownValue(input, 'exitOpen') as H1OpenEventInput,
  );
  if (
    exitOpen.contractId !== current.contractId ||
    exitOpen.instrumentId !== current.instrumentId
  ) {
    invalid('contractId', exitOpen.contractId);
  }
  if (!new ExecutionDecimal(exitOpen.price).mod(current.tickSize).isZero()) {
    invalid('exitOpen', exitOpen.price);
  }
  if (
    compare(exitOpen.openTime, roll.rollAt) !== 0 ||
    compare(exitOpen.availableAt, decisionAt) > 0
  ) {
    dataError('roll', roll.rollAt);
  }
  const adverseExitSlippage = nonnegativeExecutionDecimal(
    ownValue(input, 'adverseExitSlippagePriceUnits'),
    'adverseExitSlippagePriceUnits',
  );
  if (
    !new ExecutionDecimal(adverseExitSlippage).mod(current.tickSize).isZero()
  ) {
    invalid('adverseExitSlippagePriceUnits', adverseExitSlippage);
  }
  const exitCosts = nonnegativeExecutionDecimal(
    ownValue(input, 'exitCostsAccountCurrency'),
    'exitCostsAccountCurrency',
  );
  const monetaryValue = positiveExecutionDecimal(
    ownValue(input, 'monetaryValuePerPriceUnitAccountCurrency'),
    'monetaryValuePerPriceUnitAccountCurrency',
  );
  const exit = buildExit(
    current,
    roll,
    exitOpen,
    adverseExitSlippage,
    exitCosts,
    monetaryValue,
  );

  const reentry = snapshot(
    ownValue(input, 'reentry'),
    'reentry',
    reentryFields,
  );
  const stopPrice = positiveExecutionDecimal(reentry.stopPrice, 'stopPrice');
  const stopPolicyVersion = nonBlank(
    reentry.stopPolicyVersion,
    'stopPolicyVersion',
  );
  const stopComputedAt = instant(reentry.stopComputedAt, 'stopComputedAt');
  if (compare(stopComputedAt, roll.rollAt) !== 0) {
    dataError('stopComputedAt', stopComputedAt);
  }
  const reentryOpen = createH1OpenEvent(reentry.open as H1OpenEventInput);
  if (
    reentryOpen.contractId !== roll.toContractId ||
    reentryOpen.contractId === current.instrumentId ||
    reentryOpen.instrumentId !== current.instrumentId
  ) {
    invalid('contractId', reentryOpen.contractId);
  }
  if (
    compare(reentryOpen.openTime, roll.rollAt) !== 0 ||
    compare(reentryOpen.availableAt, decisionAt) > 0
  ) {
    dataError('roll', roll.rollAt);
  }

  const intent = createEntryIntent({
    intentId: nonBlank(reentry.intentId, 'intentId'),
    instrumentId: current.instrumentId,
    contractId: roll.toContractId,
    strategyVersion: current.strategyVersion,
    datasetVersion: current.datasetVersion,
    timeframe: '1h',
    direction: current.direction,
    signalCloseTime: current.signalCloseTime,
    expiresAt: nonBlank(reentry.expiresAt, 'expiresAt'),
    stopPrice,
    requestedQuantity: nonBlank(reentry.requestedQuantity, 'requestedQuantity'),
    riskDecisionId: nonBlank(reentry.riskDecisionId, 'riskDecisionId'),
    riskDecisionStatus: 'APPROVE',
  });
  const entryResult = executeEntryAtNextOpen({
    intent,
    open: reentryOpen,
    adverseEntrySlippagePriceUnits: nonBlank(
      reentry.adverseEntrySlippagePriceUnits,
      'adverseEntrySlippagePriceUnits',
    ),
    riskInput: reentry.riskInput as OrderRiskInput,
  });
  if (entryResult.type === 'ENTRY_CANCELLED') {
    return Object.freeze({
      type: 'ROLLOVER_EXITED_FLAT',
      exit,
      reentry: entryResult,
      position: null,
      reasons: Object.freeze([...entryResult.reasons]) as
        readonly RiskDecisionReason[] | readonly ['INVALID_STOP_AT_OPEN'],
    });
  }

  const nextPosition = createOpenPosition({
    positionId: nonBlank(reentry.positionId, 'positionId'),
    intent,
    fill: entryResult,
    entryCostAccountCurrency: nonnegativeExecutionDecimal(
      reentry.entryCostAccountCurrency,
      'entryCostAccountCurrency',
    ),
    tickSize: current.tickSize,
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion: stopPolicyVersion,
  });
  return Object.freeze({
    type: 'ROLLOVER_REENTERED',
    exit,
    reentry: entryResult,
    position: nextPosition,
  });
}
