import { Temporal } from '@js-temporal/polyfill';
import {
  asInstantString,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import {
  createEntryIntent,
  type EntryIntent,
  type EntryIntentInput,
  type ExecutionLimitation,
  type OpenPosition,
} from '@trading-auto/execution';
import {
  calculateSizingEquity,
  createRiskAccountState,
  createRiskPortfolioState,
  type ActiveEntryIntentInput,
  type RiskPolicyVersion,
  type RiskPositionInput,
} from '@trading-auto/risk';

import { clockKeyOf, compareClockKeys } from './clock.js';
import {
  asBacktestDecimal,
  asBacktestNonnegativeDecimal,
  asBacktestPositiveDecimal,
  decimalCompare,
  decimalSum,
} from './decimal.js';
import { BacktestInputError, BacktestStateError } from './errors.js';
import {
  createBacktestEvent,
  type BacktestEvent,
  type BacktestEventInput,
  type BacktestEventType,
} from './event.js';
import {
  appendLedgerEntry,
  auditBacktestLedger,
  createLedgerEntry,
  MAX_LEDGER_ENTRIES,
  validatedLedgerCash,
  validatedLedgerHasSubsequentCapital,
  validatedLedgerLastOccurredAt,
  type BacktestLedger,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerEntryInput,
} from './ledger.js';
import {
  type BacktestDailyPortfolioSnapshot,
  type BacktestIntentState,
  type BacktestOperatingStatus,
  type BacktestPortfolioState,
  type BacktestPositionState,
  snapshotRiskPolicy,
} from './portfolio.js';
import {
  readRequiredOwn,
  snapshotDenseArray,
  snapshotPlainRecord,
  snapshotSelectedOwn,
} from './validation.js';

export type BacktestPortfolioTransition =
  | Readonly<{
      type: 'REGISTER_INTENT';
      event: BacktestEvent;
      intent: BacktestIntentState;
    }>
  | Readonly<{
      type: 'CANCEL_INTENT';
      event: BacktestEvent;
      intentId: string;
    }>
  | Readonly<{
      type: 'OPEN_POSITION';
      event: BacktestEvent;
      intentId: string;
      position: BacktestPositionState;
      cashChange: string;
      ledgerEntry: LedgerEntryInput;
    }>
  | Readonly<{
      type: 'REVALUE_POSITION';
      event: BacktestEvent;
      position: BacktestPositionState;
    }>
  | Readonly<{
      type: 'APPLY_ACCOUNTING';
      event: BacktestEvent;
      cashChange: string;
      updatedPosition: BacktestPositionState | null;
      ledgerEntry: LedgerEntryInput;
    }>
  | Readonly<{
      type: 'CLOSE_POSITION';
      event: BacktestEvent;
      positionId: string;
      cashChange: string;
      ledgerEntry: LedgerEntryInput;
    }>
  | Readonly<{
      type: 'SET_ENTRY_CAPACITY';
      event: BacktestEvent;
      available: boolean;
    }>
  | Readonly<{
      type: 'SET_ACTIVE_CONTRACT';
      event: BacktestEvent;
      instrumentId: string;
      contractId: string | null;
    }>
  | Readonly<{
      type: 'RECORD_PORTFOLIO_SNAPSHOT';
      event: BacktestEvent;
      snapshotId: string;
    }>;

type ValidationMode = 'input' | 'state';

interface AggregateValues {
  readonly cash: DecimalString;
  readonly realizedEquity: DecimalString;
  readonly unrealizedPnl: DecimalString;
  readonly sizingEquity: DecimalString;
  readonly usedMargin: DecimalString;
  readonly reservedMargin: DecimalString;
  readonly availableFunds: DecimalString;
  readonly grossExposure: DecimalString;
  readonly reservedGrossExposure: DecimalString;
  readonly openRisk: DecimalString;
  readonly riskGroupExposure: Readonly<Record<string, DecimalString>>;
}

interface StateParts {
  readonly backtestId: string;
  readonly runCreatedAt: InstantString;
  readonly riskPolicyUseAt: InstantString;
  readonly policy: RiskPolicyVersion;
  readonly operatingStatus: BacktestOperatingStatus;
  readonly dailyLoss: DecimalString;
  readonly drawdownPct: DecimalString;
  readonly positions: readonly BacktestPositionState[];
  readonly activeEntryIntents: readonly BacktestIntentState[];
  readonly activeContractByInstrument: Readonly<Record<string, string>>;
  readonly dailySnapshots: readonly BacktestDailyPortfolioSnapshot[];
  readonly ledger: BacktestLedger;
  readonly processedEventCount: number;
  readonly lastClockKey: string | null;
}

const VALIDATED_STATES = new WeakMap<object, StateParts>();

const STATE_FIELDS = Object.freeze([
  'backtestId',
  'runCreatedAt',
  'riskPolicyUseMode',
  'riskPolicyUseAt',
  'riskPolicyVersion',
  'maxSizingCapital',
  'policy',
  'operatingStatus',
  'accountCurrency',
  'initialCash',
  'cash',
  'realizedEquity',
  'unrealizedPnl',
  'sizingEquity',
  'usedMargin',
  'reservedMargin',
  'availableFunds',
  'grossExposure',
  'reservedGrossExposure',
  'openRisk',
  'dailyLoss',
  'drawdownPct',
  'positions',
  'activeEntryIntents',
  'riskGroupExposure',
  'activeContractByInstrument',
  'dailySnapshots',
  'ledger',
  'processedEventCount',
  'lastClockKey',
] as const);
const POSITION_STATE_FIELDS = Object.freeze([
  'executionPosition',
  'riskPosition',
  'unrealizedPnl',
] as const);
const INTENT_STATE_FIELDS = Object.freeze([
  'executionIntent',
  'riskIntent',
  'reservedMargin',
  'reservedOpenRisk',
  'reservedGrossExposure',
  'riskGroup',
] as const);
const OPEN_POSITION_FIELDS = Object.freeze([
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
  'lastSettlementEffectiveAt',
  'executionModelVersion',
  'exitPolicyVersion',
  'limitations',
] as const);
const RISK_POSITION_FIELDS = Object.freeze([
  'positionId',
  'instrumentId',
  'contractId',
  'direction',
  'quantity',
  'remainingOpenRisk',
  'margin',
  'grossExposure',
  'riskGroup',
] as const);
const RISK_INTENT_FIELDS = Object.freeze([
  'intentId',
  'instrumentId',
  'contractId',
  'direction',
] as const);
const DAILY_SNAPSHOT_FIELDS = Object.freeze([
  'snapshotId',
  'eventId',
  'recordedAt',
  'operatingStatus',
  'cash',
  'realizedEquity',
  'unrealizedPnl',
  'sizingEquity',
  'usedMargin',
  'reservedMargin',
  'availableFunds',
  'grossExposure',
  'reservedGrossExposure',
  'openRisk',
  'dailyLoss',
  'drawdownPct',
  'positionCount',
  'activeIntentCount',
] as const);
const MAX_PORTFOLIO_ITEMS = 1_000;
const MAX_DAILY_SNAPSHOTS = 10_000;
const MAX_ACTIVE_CONTRACTS = 256;
const LIMITATIONS: readonly ExecutionLimitation[] = Object.freeze([
  'NO_INTRABAR_PATH',
  'NO_PARTIAL_FILLS',
  'NO_ORDER_BOOK',
]);

function invalid(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('INVALID_BACKTEST_INPUT', message, {
    field,
    value,
  });
}

function limit(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('BACKTEST_LIMIT_EXCEEDED', message, {
    field,
    value,
  });
}

function invalidState(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new BacktestStateError('INVALID_BACKTEST_STATE', message, details);
}

function validationFailure(
  mode: ValidationMode,
  message: string,
  field: string,
  value?: unknown,
): never {
  if (mode === 'input') invalid(message, field, value);
  invalidState(message, { field, value });
}

function nonblank(
  value: unknown,
  field: string,
  mode: ValidationMode = 'input',
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    validationFailure(
      mode,
      `${field} must be a nonblank string.`,
      field,
      value,
    );
  }
  return value;
}

function instant(
  value: unknown,
  field: string,
  mode: ValidationMode = 'input',
): InstantString {
  if (typeof value !== 'string') {
    validationFailure(mode, `${field} must be an ISO instant.`, field, value);
  }
  try {
    return asInstantString(value);
  } catch {
    validationFailure(mode, `${field} must be an ISO instant.`, field, value);
  }
}

function nullableNonblank(
  value: unknown,
  field: string,
  mode: ValidationMode = 'input',
): string | null {
  return value === null ? null : nonblank(value, field, mode);
}

function nullableInstant(
  value: unknown,
  field: string,
  mode: ValidationMode,
): InstantString | null {
  return value === null ? null : instant(value, field, mode);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    invalid(`${field} must be a boolean.`, field, value);
  }
  return value;
}

function nonnegativeSafeInteger(
  value: unknown,
  field: string,
  mode: ValidationMode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    validationFailure(
      mode,
      `${field} must be a nonnegative safe integer.`,
      field,
      value,
    );
  }
  return value as number;
}

function decimalForMode(
  value: unknown,
  field: string,
  mode: ValidationMode,
  nonnegative = false,
): DecimalString {
  try {
    return nonnegative
      ? asBacktestNonnegativeDecimal(value, field)
      : asBacktestDecimal(value, field);
  } catch (error) {
    if (mode === 'input' || !(error instanceof BacktestInputError)) throw error;
    invalidState(`${field} is invalid in portfolio state.`, { field });
  }
}

function negate(value: DecimalString): DecimalString {
  if (value === '0') return value;
  return asBacktestDecimal(`-${value}`, 'value');
}

function equalDecimal(left: DecimalString, right: DecimalString): boolean {
  return decimalCompare(left, right) === 0;
}

function assertEqualDecimal(
  actual: DecimalString,
  expected: DecimalString,
  field: string,
): void {
  if (!equalDecimal(actual, expected)) {
    invalidState(`${field} does not reconcile.`, { field, actual, expected });
  }
}

function compareStateClockKeys(current: string, previous: string): number {
  return compareClockKeys(current, previous);
}

function aggregateSum(values: readonly string[]): DecimalString {
  try {
    return asBacktestDecimal(decimalSum(values), 'aggregate');
  } catch {
    invalidState('Portfolio aggregate exceeds decimal bounds.');
  }
}

function snapshotEvent(value: unknown): BacktestEvent {
  return createBacktestEvent(
    snapshotPlainRecord(
      value,
      'transition.event',
    ) as unknown as BacktestEventInput,
  );
}

function snapshotExecutionIntent(value: unknown, field: string): EntryIntent {
  const captured = snapshotPlainRecord(value, field);
  try {
    return createEntryIntent(captured as unknown as EntryIntentInput);
  } catch {
    invalid(`${field} must be a valid execution intent.`, field);
  }
}

function snapshotRiskIntent(
  value: unknown,
  field: string,
  mode: ValidationMode,
) {
  const captured = snapshotSelectedOwn(value, field, RISK_INTENT_FIELDS);
  try {
    const portfolio = createRiskPortfolioState({
      positions: [],
      activeEntryIntents: [captured as unknown as ActiveEntryIntentInput],
    });
    return (
      portfolio.activeEntryIntents as readonly [
        (typeof portfolio.activeEntryIntents)[number],
      ]
    )[0];
  } catch {
    validationFailure(mode, `${field} must be a valid risk intent.`, field);
  }
}

function snapshotRiskPosition(
  value: unknown,
  field: string,
  mode: ValidationMode,
) {
  const captured = snapshotSelectedOwn(value, field, RISK_POSITION_FIELDS);
  try {
    const portfolio = createRiskPortfolioState({
      positions: [captured as unknown as RiskPositionInput],
      activeEntryIntents: [],
    });
    return (
      portfolio.positions as readonly [(typeof portfolio.positions)[number]]
    )[0];
  } catch {
    validationFailure(mode, `${field} must be a valid risk position.`, field);
  }
}

function snapshotLimitations(
  value: unknown,
  field: string,
  mode: ValidationMode,
): readonly ExecutionLimitation[] {
  const raw = snapshotDenseArray(value, field, LIMITATIONS.length);
  if (
    raw.length !== LIMITATIONS.length ||
    raw.some((item, index) => item !== LIMITATIONS[index])
  ) {
    validationFailure(
      mode,
      `${field} must contain execution limitations.`,
      field,
    );
  }
  return Object.freeze([...LIMITATIONS]);
}

function snapshotOpenPosition(
  value: unknown,
  field: string,
  mode: ValidationMode,
): OpenPosition {
  const raw = snapshotSelectedOwn(value, field, OPEN_POSITION_FIELDS);
  const direction = readRequiredOwn(raw, 'direction', `${field}.direction`);
  if (direction !== 'LONG' && direction !== 'SHORT') {
    validationFailure(mode, `${field}.direction must be LONG or SHORT.`, field);
  }
  if (readRequiredOwn(raw, 'timeframe', `${field}.timeframe`) !== '1h') {
    validationFailure(mode, `${field}.timeframe must be 1h.`, field);
  }
  if (
    readRequiredOwn(
      raw,
      'executionModelVersion',
      `${field}.executionModelVersion`,
    ) !== 'BAR_BASED_H1_V1'
  ) {
    validationFailure(
      mode,
      `${field}.executionModelVersion is invalid.`,
      field,
    );
  }

  const signalCloseTime = instant(
    readRequiredOwn(raw, 'signalCloseTime', `${field}.signalCloseTime`),
    `${field}.signalCloseTime`,
    mode,
  );
  const signalDecisionAt = instant(
    readRequiredOwn(raw, 'signalDecisionAt', `${field}.signalDecisionAt`),
    `${field}.signalDecisionAt`,
    mode,
  );
  const openedAt = instant(
    readRequiredOwn(raw, 'openedAt', `${field}.openedAt`),
    `${field}.openedAt`,
    mode,
  );
  const lastSettlementEffectiveAt = nullableInstant(
    readRequiredOwn(
      raw,
      'lastSettlementEffectiveAt',
      `${field}.lastSettlementEffectiveAt`,
    ),
    `${field}.lastSettlementEffectiveAt`,
    mode,
  );
  if (
    Temporal.Instant.compare(signalDecisionAt, signalCloseTime) < 0 ||
    Temporal.Instant.compare(openedAt, signalCloseTime) <= 0 ||
    Temporal.Instant.compare(openedAt, signalDecisionAt) < 0 ||
    (lastSettlementEffectiveAt !== null &&
      Temporal.Instant.compare(lastSettlementEffectiveAt, openedAt) <= 0)
  ) {
    validationFailure(mode, `${field} timestamps are inconsistent.`, field);
  }

  const economicEntryPrice = asBacktestPositiveDecimal(
    readRequiredOwn(raw, 'economicEntryPrice', `${field}.economicEntryPrice`),
    `${field}.economicEntryPrice`,
  );
  const protectiveStopPrice = asBacktestPositiveDecimal(
    readRequiredOwn(raw, 'protectiveStopPrice', `${field}.protectiveStopPrice`),
    `${field}.protectiveStopPrice`,
  );
  if (
    (direction === 'LONG' &&
      decimalCompare(protectiveStopPrice, economicEntryPrice) >= 0) ||
    (direction === 'SHORT' &&
      decimalCompare(protectiveStopPrice, economicEntryPrice) <= 0)
  ) {
    validationFailure(mode, `${field}.protectiveStopPrice is invalid.`, field);
  }

  return Object.freeze({
    positionId: nonblank(
      readRequiredOwn(raw, 'positionId', `${field}.positionId`),
      `${field}.positionId`,
      mode,
    ),
    intentId: nonblank(
      readRequiredOwn(raw, 'intentId', `${field}.intentId`),
      `${field}.intentId`,
      mode,
    ),
    riskDecisionId: nonblank(
      readRequiredOwn(raw, 'riskDecisionId', `${field}.riskDecisionId`),
      `${field}.riskDecisionId`,
      mode,
    ),
    instrumentId: nonblank(
      readRequiredOwn(raw, 'instrumentId', `${field}.instrumentId`),
      `${field}.instrumentId`,
      mode,
    ),
    contractId: nonblank(
      readRequiredOwn(raw, 'contractId', `${field}.contractId`),
      `${field}.contractId`,
      mode,
    ),
    strategyVersion: nonblank(
      readRequiredOwn(raw, 'strategyVersion', `${field}.strategyVersion`),
      `${field}.strategyVersion`,
      mode,
    ),
    datasetVersion: nonblank(
      readRequiredOwn(raw, 'datasetVersion', `${field}.datasetVersion`),
      `${field}.datasetVersion`,
      mode,
    ),
    riskPolicyVersion: nonblank(
      readRequiredOwn(raw, 'riskPolicyVersion', `${field}.riskPolicyVersion`),
      `${field}.riskPolicyVersion`,
      mode,
    ),
    timeframe: '1h',
    direction,
    quantity: asBacktestPositiveDecimal(
      readRequiredOwn(raw, 'quantity', `${field}.quantity`),
      `${field}.quantity`,
    ),
    economicEntryPrice,
    accountingBasisPrice: asBacktestPositiveDecimal(
      readRequiredOwn(
        raw,
        'accountingBasisPrice',
        `${field}.accountingBasisPrice`,
      ),
      `${field}.accountingBasisPrice`,
    ),
    protectiveStopPrice,
    entryCostAccountCurrency: asBacktestNonnegativeDecimal(
      readRequiredOwn(
        raw,
        'entryCostAccountCurrency',
        `${field}.entryCostAccountCurrency`,
      ),
      `${field}.entryCostAccountCurrency`,
    ),
    tickSize: asBacktestPositiveDecimal(
      readRequiredOwn(raw, 'tickSize', `${field}.tickSize`),
      `${field}.tickSize`,
    ),
    signalCloseTime,
    signalDecisionAt,
    openedAt,
    lastSettlementEffectiveAt,
    executionModelVersion: 'BAR_BASED_H1_V1',
    exitPolicyVersion: nonblank(
      readRequiredOwn(raw, 'exitPolicyVersion', `${field}.exitPolicyVersion`),
      `${field}.exitPolicyVersion`,
      mode,
    ),
    limitations: snapshotLimitations(
      readRequiredOwn(raw, 'limitations', `${field}.limitations`),
      `${field}.limitations`,
      mode,
    ),
  });
}

function snapshotPositionState(
  value: unknown,
  field: string,
  mode: ValidationMode,
): BacktestPositionState {
  const raw = snapshotSelectedOwn(value, field, POSITION_STATE_FIELDS);
  const executionPosition = snapshotOpenPosition(
    readRequiredOwn(raw, 'executionPosition', `${field}.executionPosition`),
    `${field}.executionPosition`,
    mode,
  );
  const riskPosition = snapshotRiskPosition(
    readRequiredOwn(raw, 'riskPosition', `${field}.riskPosition`),
    `${field}.riskPosition`,
    mode,
  );
  if (
    executionPosition.positionId !== riskPosition.positionId ||
    executionPosition.instrumentId !== riskPosition.instrumentId ||
    executionPosition.contractId !== riskPosition.contractId ||
    executionPosition.direction !== riskPosition.direction ||
    !equalDecimal(executionPosition.quantity, riskPosition.quantity)
  ) {
    invalidState('Execution and risk position identities must match.', {
      positionId: executionPosition.positionId,
    });
  }
  return Object.freeze({
    executionPosition,
    riskPosition,
    unrealizedPnl: decimalForMode(
      readRequiredOwn(raw, 'unrealizedPnl', `${field}.unrealizedPnl`),
      `${field}.unrealizedPnl`,
      mode,
    ),
  });
}

function snapshotIntentState(
  value: unknown,
  field: string,
  mode: ValidationMode,
): BacktestIntentState {
  const raw = snapshotSelectedOwn(value, field, INTENT_STATE_FIELDS);
  const executionIntent = snapshotExecutionIntent(
    readRequiredOwn(raw, 'executionIntent', `${field}.executionIntent`),
    `${field}.executionIntent`,
  );
  const riskIntent = snapshotRiskIntent(
    readRequiredOwn(raw, 'riskIntent', `${field}.riskIntent`),
    `${field}.riskIntent`,
    mode,
  );
  if (
    executionIntent.intentId !== riskIntent.intentId ||
    executionIntent.instrumentId !== riskIntent.instrumentId ||
    executionIntent.contractId !== riskIntent.contractId ||
    executionIntent.direction !== riskIntent.direction
  ) {
    invalidState('Execution and risk intent identities must match.', {
      intentId: executionIntent.intentId,
    });
  }
  return Object.freeze({
    executionIntent,
    riskIntent,
    reservedMargin: decimalForMode(
      readRequiredOwn(raw, 'reservedMargin', `${field}.reservedMargin`),
      `${field}.reservedMargin`,
      mode,
      true,
    ),
    reservedOpenRisk: decimalForMode(
      readRequiredOwn(raw, 'reservedOpenRisk', `${field}.reservedOpenRisk`),
      `${field}.reservedOpenRisk`,
      mode,
      true,
    ),
    reservedGrossExposure: decimalForMode(
      readRequiredOwn(
        raw,
        'reservedGrossExposure',
        `${field}.reservedGrossExposure`,
      ),
      `${field}.reservedGrossExposure`,
      mode,
      true,
    ),
    riskGroup: nonblank(
      readRequiredOwn(raw, 'riskGroup', `${field}.riskGroup`),
      `${field}.riskGroup`,
      mode,
    ),
  });
}

function validatePortfolioIdentities(
  positions: readonly BacktestPositionState[],
  intents: readonly BacktestIntentState[],
): void {
  try {
    createRiskPortfolioState({
      positions: positions.map(({ riskPosition }) => riskPosition),
      activeEntryIntents: intents.map(({ riskIntent }) => riskIntent),
    });
  } catch {
    invalidState('Portfolio identities violate risk invariants.');
  }
}

function sortPositions(
  positions: readonly BacktestPositionState[],
): readonly BacktestPositionState[] {
  const result = [...positions];
  result.sort((left, right) =>
    left.executionPosition.positionId < right.executionPosition.positionId
      ? -1
      : 1,
  );
  return Object.freeze(result);
}

function sortIntents(
  intents: readonly BacktestIntentState[],
): readonly BacktestIntentState[] {
  const result = [...intents];
  result.sort((left, right) =>
    left.executionIntent.intentId < right.executionIntent.intentId ? -1 : 1,
  );
  return Object.freeze(result);
}

function snapshotPositions(
  value: unknown,
  mode: ValidationMode,
): readonly BacktestPositionState[] {
  const raw = snapshotDenseArray(value, 'state.positions', MAX_PORTFOLIO_ITEMS);
  return sortPositions(
    raw.map((item, index) =>
      snapshotPositionState(item, `state.positions[${String(index)}]`, mode),
    ),
  );
}

function snapshotIntents(
  value: unknown,
  mode: ValidationMode,
): readonly BacktestIntentState[] {
  const raw = snapshotDenseArray(
    value,
    'state.activeEntryIntents',
    MAX_PORTFOLIO_ITEMS,
  );
  return sortIntents(
    raw.map((item, index) =>
      snapshotIntentState(
        item,
        `state.activeEntryIntents[${String(index)}]`,
        mode,
      ),
    ),
  );
}

function snapshotActiveContracts(
  value: unknown,
): Readonly<Record<string, string>> {
  const raw = snapshotPlainRecord(value, 'state.activeContractByInstrument');
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const key of Object.keys(raw).sort()) {
    Object.defineProperty(result, nonblank(key, 'instrumentId', 'state'), {
      configurable: false,
      enumerable: true,
      value: nonblank(
        raw[key],
        `state.activeContractByInstrument.${key}`,
        'state',
      ),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function operatingStatus(
  value: unknown,
  field: string,
  mode: ValidationMode,
): BacktestOperatingStatus {
  if (value !== 'RUNNING' && value !== 'NO_NEW_ENTRIES') {
    validationFailure(mode, `${field} is invalid.`, field, value);
  }
  return value;
}

function snapshotDailySnapshot(
  value: unknown,
  index: number,
): BacktestDailyPortfolioSnapshot {
  const field = `state.dailySnapshots[${String(index)}]`;
  const raw = snapshotSelectedOwn(value, field, DAILY_SNAPSHOT_FIELDS);
  const decimal = (
    name: (typeof DAILY_SNAPSHOT_FIELDS)[number],
    nonnegative = false,
  ) =>
    decimalForMode(
      readRequiredOwn(raw, name, `${field}.${name}`),
      `${field}.${name}`,
      'state',
      nonnegative,
    );
  return Object.freeze({
    snapshotId: nonblank(
      readRequiredOwn(raw, 'snapshotId', `${field}.snapshotId`),
      `${field}.snapshotId`,
      'state',
    ),
    eventId: nonblank(
      readRequiredOwn(raw, 'eventId', `${field}.eventId`),
      `${field}.eventId`,
      'state',
    ),
    recordedAt: instant(
      readRequiredOwn(raw, 'recordedAt', `${field}.recordedAt`),
      `${field}.recordedAt`,
      'state',
    ),
    operatingStatus: operatingStatus(
      readRequiredOwn(raw, 'operatingStatus', `${field}.operatingStatus`),
      `${field}.operatingStatus`,
      'state',
    ),
    cash: decimal('cash'),
    realizedEquity: decimal('realizedEquity'),
    unrealizedPnl: decimal('unrealizedPnl'),
    sizingEquity: decimal('sizingEquity', true),
    usedMargin: decimal('usedMargin', true),
    reservedMargin: decimal('reservedMargin', true),
    availableFunds: decimal('availableFunds'),
    grossExposure: decimal('grossExposure', true),
    reservedGrossExposure: decimal('reservedGrossExposure', true),
    openRisk: decimal('openRisk', true),
    dailyLoss: decimal('dailyLoss', true),
    drawdownPct: decimal('drawdownPct', true),
    positionCount: nonnegativeSafeInteger(
      readRequiredOwn(raw, 'positionCount', `${field}.positionCount`),
      `${field}.positionCount`,
      'state',
    ),
    activeIntentCount: nonnegativeSafeInteger(
      readRequiredOwn(raw, 'activeIntentCount', `${field}.activeIntentCount`),
      `${field}.activeIntentCount`,
      'state',
    ),
  });
}

function snapshotDailySnapshots(
  value: unknown,
): readonly BacktestDailyPortfolioSnapshot[] {
  const raw = snapshotDenseArray(
    value,
    'state.dailySnapshots',
    MAX_DAILY_SNAPSHOTS,
  );
  const result = raw.map(snapshotDailySnapshot);
  const ids = new Set<string>();
  const eventIds = new Set<string>();
  let previous: BacktestDailyPortfolioSnapshot | undefined;
  for (const snapshot of result) {
    if (ids.has(snapshot.snapshotId)) {
      invalidState('Daily snapshot IDs must be unique.', {
        snapshotId: snapshot.snapshotId,
      });
    }
    if (eventIds.has(snapshot.eventId)) {
      invalidState('Daily snapshot event IDs must be unique.', {
        eventId: snapshot.eventId,
      });
    }
    if (
      previous !== undefined &&
      Temporal.Instant.compare(snapshot.recordedAt, previous.recordedAt) < 0
    ) {
      invalidState('Daily snapshots must be chronological.');
    }
    ids.add(snapshot.snapshotId);
    eventIds.add(snapshot.eventId);
    previous = snapshot;
  }
  return Object.freeze(result);
}

function assertLedgerInitialization(
  ledger: BacktestLedger,
  backtestId: string,
  policy: RiskPolicyVersion,
): void {
  const first = ledger[0];
  if (first === undefined) invalidState('Portfolio ledger must not be empty.');
  const firstCash = first.postings[0];
  const firstCapital = first.postings[1];
  if (
    first.entryId !== `initialization:${backtestId}` ||
    first.eventId !== `run:${backtestId}:initialization` ||
    first.fxSnapshotVersion !== null ||
    first.postings.length !== 2 ||
    firstCash?.account !== 'CASH' ||
    !equalDecimal(firstCash.amount, policy.initialCapital) ||
    firstCapital?.account !== 'CAPITAL' ||
    !equalDecimal(firstCapital.amount, negate(policy.initialCapital))
  ) {
    invalidState('Portfolio ledger initialization is invalid.');
  }
  if (validatedLedgerHasSubsequentCapital(ledger) === true) {
    invalidState('CAPITAL may only be posted during initialization.');
  }
}

function snapshotLedger(
  value: unknown,
  backtestId: string,
  policy: RiskPolicyVersion,
): BacktestLedger {
  if (typeof value === 'object' && value !== null) {
    const trusted = value as BacktestLedger;
    if (validatedLedgerCash(trusted) !== undefined) {
      assertLedgerInitialization(trusted, backtestId, policy);
      return trusted;
    }
  }
  let ledger: BacktestLedger;
  try {
    ledger = auditBacktestLedger(value, MAX_LEDGER_ENTRIES);
  } catch (error) {
    if (error instanceof BacktestStateError) throw error;
    invalidState('Stored ledger entry is invalid.');
  }
  assertLedgerInitialization(ledger, backtestId, policy);
  return ledger;
}

function riskGroupExposure(
  policy: RiskPolicyVersion,
  positions: readonly BacktestPositionState[],
  intents: readonly BacktestIntentState[],
): Readonly<Record<string, DecimalString>> {
  const values = new Map<string, DecimalString>();
  for (const group of Object.keys(policy.riskGroupMaxExposurePct)) {
    values.set(group, asBacktestDecimal('0', 'riskGroupExposure'));
  }
  for (const [group, amount] of [
    ...positions.map(
      ({ riskPosition }) =>
        [riskPosition.riskGroup, riskPosition.grossExposure] as const,
    ),
    ...intents.map(
      ({ riskGroup, reservedGrossExposure }) =>
        [riskGroup, reservedGrossExposure] as const,
    ),
  ]) {
    const current = values.get(group);
    if (current === undefined) {
      invalidState('Portfolio references an unknown policy risk group.', {
        group,
      });
    }
    values.set(group, aggregateSum([current, amount]));
  }
  const result: Record<string, DecimalString> = Object.create(null) as Record<
    string,
    DecimalString
  >;
  for (const group of [...values.keys()].sort()) {
    Object.defineProperty(result, group, {
      configurable: false,
      enumerable: true,
      value: values.get(group),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function calculateAggregates(
  policy: RiskPolicyVersion,
  positions: readonly BacktestPositionState[],
  intents: readonly BacktestIntentState[],
  ledger: BacktestLedger,
): AggregateValues {
  // snapshotLedger and appendLedgerEntry register the exact running cash total.
  const cash = validatedLedgerCash(ledger) as DecimalString;
  const unrealizedPnl = aggregateSum(
    positions.map(({ unrealizedPnl: amount }) => amount),
  );
  const usedMargin = aggregateSum(
    positions.map(({ riskPosition }) => riskPosition.margin),
  );
  const reservedMargin = aggregateSum(
    intents.map(({ reservedMargin: amount }) => amount),
  );
  const grossExposure = aggregateSum(
    positions.map(({ riskPosition }) => riskPosition.grossExposure),
  );
  const reservedGrossExposure = aggregateSum(
    intents.map(({ reservedGrossExposure: amount }) => amount),
  );
  const openRisk = aggregateSum([
    ...positions.map(({ riskPosition }) => riskPosition.remainingOpenRisk),
    ...intents.map(({ reservedOpenRisk }) => reservedOpenRisk),
  ]);
  const committedMargin = aggregateSum([usedMargin, reservedMargin]);
  const availableFunds = aggregateSum([
    cash,
    unrealizedPnl,
    negate(committedMargin),
  ]);
  const sizingEquity = calculateSizingEquity(
    createRiskAccountState({
      accountCurrency: policy.accountCurrency,
      realizedEquity: cash,
      unrealizedPnl,
      availableFunds,
      usedMargin: committedMargin,
      grossExposure: aggregateSum([grossExposure, reservedGrossExposure]),
      openRisk,
      dailyLoss: '0',
      drawdownPct: '0',
      killSwitchActive: false,
    }),
    policy,
  );
  return Object.freeze({
    cash,
    realizedEquity: cash,
    unrealizedPnl,
    sizingEquity,
    usedMargin,
    reservedMargin,
    availableFunds,
    grossExposure,
    reservedGrossExposure,
    openRisk,
    riskGroupExposure: riskGroupExposure(policy, positions, intents),
  });
}

function assertRiskGroupExposure(
  value: unknown,
  expected: Readonly<Record<string, DecimalString>>,
): void {
  const actual = snapshotPlainRecord(value, 'state.riskGroupExposure');
  if (
    Object.keys(actual).sort().join('\u0000') !==
    Object.keys(expected).sort().join('\u0000')
  ) {
    invalidState('riskGroupExposure keys do not reconcile.');
  }
  for (const key of Object.keys(expected)) {
    const expectedValue = expected[key] as DecimalString;
    assertEqualDecimal(
      decimalForMode(
        actual[key],
        `state.riskGroupExposure.${key}`,
        'state',
        true,
      ),
      expectedValue,
      `riskGroupExposure.${key}`,
    );
  }
}

function snapshotState(value: BacktestPortfolioState): StateParts {
  const trusted = VALIDATED_STATES.get(value);
  if (trusted !== undefined) return trusted;
  const raw = snapshotSelectedOwn(value, 'state', STATE_FIELDS);
  const backtestId = nonblank(
    readRequiredOwn(raw, 'backtestId', 'state.backtestId'),
    'state.backtestId',
    'state',
  );
  const runCreatedAt = instant(
    readRequiredOwn(raw, 'runCreatedAt', 'state.runCreatedAt'),
    'state.runCreatedAt',
    'state',
  );
  if (
    readRequiredOwn(raw, 'riskPolicyUseMode', 'state.riskPolicyUseMode') !==
    'HISTORICAL_RESEARCH'
  ) {
    invalidState('State riskPolicyUseMode is invalid.');
  }
  const riskPolicyUseAt = instant(
    readRequiredOwn(raw, 'riskPolicyUseAt', 'state.riskPolicyUseAt'),
    'state.riskPolicyUseAt',
    'state',
  );
  if (riskPolicyUseAt !== runCreatedAt) {
    invalidState('State policy-use time does not match run creation.');
  }
  let policy: RiskPolicyVersion;
  try {
    policy = snapshotRiskPolicy(readRequiredOwn(raw, 'policy', 'state.policy'));
  } catch {
    invalidState('Stored risk policy is invalid.');
  }
  if (
    readRequiredOwn(raw, 'riskPolicyVersion', 'state.riskPolicyVersion') !==
      policy.version ||
    readRequiredOwn(raw, 'maxSizingCapital', 'state.maxSizingCapital') !==
      policy.maxSizingCapital ||
    readRequiredOwn(raw, 'accountCurrency', 'state.accountCurrency') !==
      policy.accountCurrency ||
    readRequiredOwn(raw, 'initialCash', 'state.initialCash') !==
      policy.initialCapital
  ) {
    invalidState('State policy mirrors do not reconcile.');
  }
  const positions = snapshotPositions(
    readRequiredOwn(raw, 'positions', 'state.positions'),
    'state',
  );
  const activeEntryIntents = snapshotIntents(
    readRequiredOwn(raw, 'activeEntryIntents', 'state.activeEntryIntents'),
    'state',
  );
  validatePortfolioIdentities(positions, activeEntryIntents);
  for (const { executionPosition } of positions) {
    if (executionPosition.riskPolicyVersion !== policy.version) {
      invalidState('Position risk policy version differs from run policy.');
    }
  }
  const ledger = snapshotLedger(
    readRequiredOwn(raw, 'ledger', 'state.ledger'),
    backtestId,
    policy,
  );
  const aggregates = calculateAggregates(
    policy,
    positions,
    activeEntryIntents,
    ledger,
  );
  for (const field of [
    'cash',
    'realizedEquity',
    'unrealizedPnl',
    'sizingEquity',
    'usedMargin',
    'reservedMargin',
    'availableFunds',
    'grossExposure',
    'reservedGrossExposure',
    'openRisk',
  ] as const) {
    assertEqualDecimal(
      decimalForMode(
        readRequiredOwn(raw, field, `state.${field}`),
        `state.${field}`,
        'state',
        field !== 'cash' &&
          field !== 'realizedEquity' &&
          field !== 'unrealizedPnl' &&
          field !== 'availableFunds',
      ),
      aggregates[field],
      field,
    );
  }
  assertRiskGroupExposure(
    readRequiredOwn(raw, 'riskGroupExposure', 'state.riskGroupExposure'),
    aggregates.riskGroupExposure,
  );
  const lastClockKeyValue = readRequiredOwn(
    raw,
    'lastClockKey',
    'state.lastClockKey',
  );
  const lastClockKey =
    lastClockKeyValue === null
      ? null
      : nonblank(lastClockKeyValue, 'state.lastClockKey', 'state');
  const dailySnapshots = snapshotDailySnapshots(
    readRequiredOwn(raw, 'dailySnapshots', 'state.dailySnapshots'),
  );
  const processedEventCount = nonnegativeSafeInteger(
    readRequiredOwn(raw, 'processedEventCount', 'state.processedEventCount'),
    'state.processedEventCount',
    'state',
  );
  assertStateCausality(
    runCreatedAt,
    positions,
    activeEntryIntents,
    dailySnapshots,
    ledger,
    processedEventCount,
    lastClockKey,
  );

  return Object.freeze({
    backtestId,
    runCreatedAt,
    riskPolicyUseAt,
    policy,
    operatingStatus: operatingStatus(
      readRequiredOwn(raw, 'operatingStatus', 'state.operatingStatus'),
      'state.operatingStatus',
      'state',
    ),
    dailyLoss: decimalForMode(
      readRequiredOwn(raw, 'dailyLoss', 'state.dailyLoss'),
      'state.dailyLoss',
      'state',
      true,
    ),
    drawdownPct: decimalForMode(
      readRequiredOwn(raw, 'drawdownPct', 'state.drawdownPct'),
      'state.drawdownPct',
      'state',
      true,
    ),
    positions,
    activeEntryIntents,
    activeContractByInstrument: snapshotActiveContracts(
      readRequiredOwn(
        raw,
        'activeContractByInstrument',
        'state.activeContractByInstrument',
      ),
    ),
    dailySnapshots,
    ledger,
    processedEventCount,
    lastClockKey,
  });
}

function assertEventType(
  transitionName: BacktestPortfolioTransition['type'],
  eventType: BacktestEventType,
): void {
  const compatible: Readonly<
    Record<
      BacktestPortfolioTransition['type'],
      readonly BacktestEventType[] | null
    >
  > = {
    REGISTER_INTENT: ['SIGNAL_DECISION'],
    CANCEL_INTENT: ['OPEN_ENTRY'],
    OPEN_POSITION: ['OPEN_ENTRY'],
    REVALUE_POSITION: ['CLOSED_BAR_POSITION'],
    APPLY_ACCOUNTING: [
      'DAILY_SETTLEMENT',
      'ROLL',
      'OPEN_EXIT',
      'CLOSED_BAR_POSITION',
    ],
    CLOSE_POSITION: ['CLOSED_BAR_POSITION', 'OPEN_EXIT', 'ROLL'],
    SET_ENTRY_CAPACITY: null,
    SET_ACTIVE_CONTRACT: ['DATA_AVAILABLE', 'ROLL'],
    RECORD_PORTFOLIO_SNAPSHOT: ['PORTFOLIO_SNAPSHOT'],
  };
  const accepted = compatible[transitionName];
  if (accepted !== null && !accepted.includes(eventType)) {
    invalid(
      `${transitionName} is incompatible with ${eventType}.`,
      'transition.event.type',
      eventType,
    );
  }
}

function assertEventSubject(
  event: BacktestEvent,
  instrumentId: string,
  contractId?: string,
): void {
  if (
    event.instrumentId !== instrumentId ||
    (contractId !== undefined && event.contractId !== contractId)
  ) {
    invalidState('Event provenance differs from its transition entity.', {
      eventId: event.semanticId,
      eventInstrumentId: event.instrumentId,
      eventContractId: event.contractId,
      instrumentId,
      ...(contractId === undefined ? {} : { contractId }),
    });
  }
}

function transitionType(value: unknown): BacktestPortfolioTransition['type'] {
  if (
    value !== 'REGISTER_INTENT' &&
    value !== 'CANCEL_INTENT' &&
    value !== 'OPEN_POSITION' &&
    value !== 'REVALUE_POSITION' &&
    value !== 'APPLY_ACCOUNTING' &&
    value !== 'CLOSE_POSITION' &&
    value !== 'SET_ENTRY_CAPACITY' &&
    value !== 'SET_ACTIVE_CONTRACT' &&
    value !== 'RECORD_PORTFOLIO_SNAPSHOT'
  ) {
    invalid('transition.type is unsupported.', 'transition.type', value);
  }
  return value;
}

function entryById(
  intents: readonly BacktestIntentState[],
  intentId: string,
): BacktestIntentState | undefined {
  return intents.find(
    ({ executionIntent }) => executionIntent.intentId === intentId,
  );
}

function positionById(
  positions: readonly BacktestPositionState[],
  positionId: string,
): BacktestPositionState | undefined {
  return positions.find(
    ({ executionPosition }) => executionPosition.positionId === positionId,
  );
}

function sameRevaluationPosition(
  current: BacktestPositionState,
  updated: BacktestPositionState,
): boolean {
  return (
    JSON.stringify(current.executionPosition) ===
      JSON.stringify(updated.executionPosition) &&
    JSON.stringify(current.riskPosition) ===
      JSON.stringify(updated.riskPosition)
  );
}

function equalSelectedFields(
  current: object,
  updated: object,
  fields: readonly string[],
  mutableFields: readonly string[],
): boolean {
  const currentRecord = current as Readonly<Record<string, unknown>>;
  const updatedRecord = updated as Readonly<Record<string, unknown>>;
  return fields.every(
    (field) =>
      mutableFields.includes(field) ||
      JSON.stringify(currentRecord[field]) ===
        JSON.stringify(updatedRecord[field]),
  );
}

function sameAccountingPosition(
  current: BacktestPositionState,
  updated: BacktestPositionState,
): boolean {
  return (
    equalSelectedFields(
      current.executionPosition,
      updated.executionPosition,
      OPEN_POSITION_FIELDS,
      ['accountingBasisPrice', 'lastSettlementEffectiveAt'],
    ) &&
    equalSelectedFields(
      current.riskPosition,
      updated.riskPosition,
      RISK_POSITION_FIELDS,
      ['remainingOpenRisk', 'margin', 'grossExposure'],
    )
  );
}

function stateClockInstant(clockKey: string): Temporal.Instant {
  try {
    compareClockKeys(clockKey, clockKey);
    return Temporal.Instant.from(clockKey.slice(0, clockKey.indexOf('|')));
  } catch {
    invalidState('State lastClockKey is malformed.', { clockKey });
  }
}

function assertNotAfterStateClock(
  value: InstantString,
  clock: Temporal.Instant,
  field: string,
): void {
  if (Temporal.Instant.compare(Temporal.Instant.from(value), clock) > 0) {
    invalidState(`${field} is later than the state clock.`, { field, value });
  }
}

function assertStateCausality(
  runCreatedAt: InstantString,
  positions: readonly BacktestPositionState[],
  intents: readonly BacktestIntentState[],
  snapshots: readonly BacktestDailyPortfolioSnapshot[],
  ledger: BacktestLedger,
  processedEventCount: number,
  lastClockKey: string | null,
): void {
  if (ledger[0]?.occurredAt !== runCreatedAt) {
    invalidState('Initial ledger time differs from run creation.');
  }
  const clock = lastClockKey === null ? null : stateClockInstant(lastClockKey);
  if ((processedEventCount === 0) !== (lastClockKey === null)) {
    invalidState('Event count and last clock key do not reconcile.');
  }
  if (clock === null) return;

  for (const [index, position] of positions.entries()) {
    assertNotAfterStateClock(
      position.executionPosition.signalDecisionAt,
      clock,
      `positions[${String(index)}].signalDecisionAt`,
    );
    assertNotAfterStateClock(
      position.executionPosition.openedAt,
      clock,
      `positions[${String(index)}].openedAt`,
    );
    if (position.executionPosition.lastSettlementEffectiveAt !== null) {
      assertNotAfterStateClock(
        position.executionPosition.lastSettlementEffectiveAt,
        clock,
        `positions[${String(index)}].lastSettlementEffectiveAt`,
      );
    }
  }
  for (const [index, intent] of intents.entries()) {
    assertNotAfterStateClock(
      intent.executionIntent.signalDecisionAt,
      clock,
      `activeEntryIntents[${String(index)}].signalDecisionAt`,
    );
  }
  for (const [index, snapshot] of snapshots.entries()) {
    assertNotAfterStateClock(
      snapshot.recordedAt,
      clock,
      `dailySnapshots[${String(index)}].recordedAt`,
    );
  }
  // Non-empty ledgers are registered by snapshotLedger before reconciliation.
  const lastLedgerTime = validatedLedgerLastOccurredAt(ledger) as InstantString;
  assertNotAfterStateClock(
    lastLedgerTime,
    clock,
    `ledger[${String(ledger.length - 1)}].occurredAt`,
  );
}

function validateCashEntry(
  rawEntry: unknown,
  event: BacktestEvent,
  cashChangeValue: unknown,
): {
  readonly entry: LedgerEntry;
  readonly cashChange: DecimalString;
  readonly balancingAccount: LedgerAccount;
} {
  const cashChange = asBacktestDecimal(cashChangeValue, 'cashChange');
  let entry: LedgerEntry;
  try {
    entry = createLedgerEntry(
      snapshotPlainRecord(
        rawEntry,
        'ledgerEntry',
      ) as unknown as LedgerEntryInput,
    );
  } catch (error) {
    if (error instanceof BacktestStateError) throw error;
    invalid('ledgerEntry is invalid.', 'ledgerEntry');
  }
  if (
    entry.eventId !== event.semanticId ||
    entry.occurredAt !== event.availableAt
  ) {
    invalidState('Ledger entry provenance must match its transition event.');
  }
  const cashPosting = entry.postings.find(({ account }) => account === 'CASH');
  if (
    cashPosting === undefined ||
    !equalDecimal(cashPosting.amount, cashChange)
  ) {
    invalidState('Ledger CASH posting must equal cashChange.');
  }
  if (entry.postings.some(({ account }) => account === 'CAPITAL')) {
    invalidState('CAPITAL cannot be posted after initialization.');
  }
  const balancing = entry.postings.filter(({ account }) => account !== 'CASH');
  if (balancing.length !== 1) {
    invalidState('Cash movement must use one supported balancing account.');
  }
  const balancingPosting = (balancing as [LedgerEntry['postings'][number]])[0];
  if (
    decimalCompare(cashChange, '0') > 0 &&
    balancingPosting.account === 'COSTS'
  ) {
    invalidState('Positive cash cannot be explained by COSTS.');
  }
  return Object.freeze({
    entry,
    cashChange,
    balancingAccount: balancingPosting.account,
  });
}

function sortedActiveContracts(
  current: Readonly<Record<string, string>>,
  instrumentId: string,
  contractId: string | null,
): Readonly<Record<string, string>> {
  const values = new Map(Object.entries(current));
  if (contractId === null) values.delete(instrumentId);
  else values.set(instrumentId, contractId);
  if (values.size > MAX_ACTIVE_CONTRACTS) {
    limit(
      `activeContractByInstrument exceeds ${String(MAX_ACTIVE_CONTRACTS)} items.`,
      'activeContractByInstrument',
      values.size,
    );
  }
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const key of [...values.keys()].sort()) {
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: values.get(key),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function portfolioSnapshot(
  snapshotId: string,
  event: BacktestEvent,
  status: BacktestOperatingStatus,
  dailyLoss: DecimalString,
  drawdownPct: DecimalString,
  positions: readonly BacktestPositionState[],
  intents: readonly BacktestIntentState[],
  aggregates: AggregateValues,
): BacktestDailyPortfolioSnapshot {
  return Object.freeze({
    snapshotId,
    eventId: event.semanticId,
    recordedAt: event.availableAt,
    operatingStatus: status,
    cash: aggregates.cash,
    realizedEquity: aggregates.realizedEquity,
    unrealizedPnl: aggregates.unrealizedPnl,
    sizingEquity: aggregates.sizingEquity,
    usedMargin: aggregates.usedMargin,
    reservedMargin: aggregates.reservedMargin,
    availableFunds: aggregates.availableFunds,
    grossExposure: aggregates.grossExposure,
    reservedGrossExposure: aggregates.reservedGrossExposure,
    openRisk: aggregates.openRisk,
    dailyLoss,
    drawdownPct,
    positionCount: positions.length,
    activeIntentCount: intents.length,
  });
}

function assembleState(
  base: StateParts,
  values: Readonly<{
    operatingStatus: BacktestOperatingStatus;
    positions: readonly BacktestPositionState[];
    activeEntryIntents: readonly BacktestIntentState[];
    activeContractByInstrument: Readonly<Record<string, string>>;
    dailySnapshots: readonly BacktestDailyPortfolioSnapshot[];
    ledger: BacktestLedger;
    processedEventCount: number;
    lastClockKey: string;
  }>,
): BacktestPortfolioState {
  const positions = sortPositions(values.positions);
  const activeEntryIntents = sortIntents(values.activeEntryIntents);
  validatePortfolioIdentities(positions, activeEntryIntents);
  for (const { executionPosition } of positions) {
    if (executionPosition.riskPolicyVersion !== base.policy.version) {
      invalidState('Position risk policy version differs from run policy.');
    }
  }
  const aggregates = calculateAggregates(
    base.policy,
    positions,
    activeEntryIntents,
    values.ledger,
  );
  const processedEventCount = nonnegativeSafeInteger(
    values.processedEventCount,
    'processedEventCount',
    'state',
  );
  assertStateCausality(
    base.runCreatedAt,
    positions,
    activeEntryIntents,
    values.dailySnapshots,
    values.ledger,
    processedEventCount,
    values.lastClockKey,
  );
  const result = Object.freeze({
    backtestId: base.backtestId,
    runCreatedAt: base.runCreatedAt,
    riskPolicyUseMode: 'HISTORICAL_RESEARCH',
    riskPolicyUseAt: base.riskPolicyUseAt,
    riskPolicyVersion: base.policy.version,
    maxSizingCapital: base.policy.maxSizingCapital,
    policy: base.policy,
    operatingStatus: values.operatingStatus,
    accountCurrency: base.policy.accountCurrency,
    initialCash: base.policy.initialCapital,
    cash: aggregates.cash,
    realizedEquity: aggregates.realizedEquity,
    unrealizedPnl: aggregates.unrealizedPnl,
    sizingEquity: aggregates.sizingEquity,
    usedMargin: aggregates.usedMargin,
    reservedMargin: aggregates.reservedMargin,
    availableFunds: aggregates.availableFunds,
    grossExposure: aggregates.grossExposure,
    reservedGrossExposure: aggregates.reservedGrossExposure,
    openRisk: aggregates.openRisk,
    dailyLoss: base.dailyLoss,
    drawdownPct: base.drawdownPct,
    positions,
    activeEntryIntents,
    riskGroupExposure: aggregates.riskGroupExposure,
    activeContractByInstrument: values.activeContractByInstrument,
    dailySnapshots: values.dailySnapshots,
    ledger: values.ledger,
    processedEventCount,
    lastClockKey: values.lastClockKey,
  });
  VALIDATED_STATES.set(
    result,
    Object.freeze({
      backtestId: base.backtestId,
      runCreatedAt: base.runCreatedAt,
      riskPolicyUseAt: base.riskPolicyUseAt,
      policy: base.policy,
      operatingStatus: values.operatingStatus,
      dailyLoss: base.dailyLoss,
      drawdownPct: base.drawdownPct,
      positions,
      activeEntryIntents,
      activeContractByInstrument: values.activeContractByInstrument,
      dailySnapshots: values.dailySnapshots,
      ledger: values.ledger,
      processedEventCount,
      lastClockKey: values.lastClockKey,
    }),
  );
  return result;
}

export function reduceBacktestPortfolio(
  state: BacktestPortfolioState,
  transition: BacktestPortfolioTransition,
): BacktestPortfolioState {
  const base = snapshotState(state);
  const raw = snapshotPlainRecord(transition, 'transition');
  const type = transitionType(readRequiredOwn(raw, 'type', 'transition.type'));
  const currentEvent = snapshotEvent(
    readRequiredOwn(raw, 'event', 'transition.event'),
  );
  assertEventType(type, currentEvent.type);
  const nextClockKey = clockKeyOf(currentEvent);
  if (
    base.lastClockKey !== null &&
    compareStateClockKeys(nextClockKey, base.lastClockKey) < 0
  ) {
    throw new BacktestStateError(
      'EVENT_ORDER_VIOLATION',
      'Portfolio transitions must be monotonic by clock key.',
      { current: nextClockKey, previous: base.lastClockKey },
    );
  }

  let operatingStatus = base.operatingStatus;
  let positions = [...base.positions];
  let intents = [...base.activeEntryIntents];
  let contracts = base.activeContractByInstrument;
  const snapshots = [...base.dailySnapshots];
  let ledger = base.ledger;

  switch (type) {
    case 'REGISTER_INTENT': {
      if (operatingStatus !== 'RUNNING') {
        invalidState('New entry intents are disabled.');
      }
      const intent = snapshotIntentState(
        readRequiredOwn(raw, 'intent', 'transition.intent'),
        'transition.intent',
        'input',
      );
      assertEventSubject(
        currentEvent,
        intent.executionIntent.instrumentId,
        intent.executionIntent.contractId,
      );
      if (
        entryById(intents, intent.executionIntent.intentId) !== undefined ||
        intents.some(
          ({ executionIntent }) =>
            executionIntent.instrumentId ===
            intent.executionIntent.instrumentId,
        ) ||
        positions.some(
          ({ executionPosition }) =>
            executionPosition.instrumentId ===
            intent.executionIntent.instrumentId,
        )
      ) {
        invalidState('Entry intent identity is already active.');
      }
      if (intents.length >= MAX_PORTFOLIO_ITEMS) {
        limit(
          `activeEntryIntents exceeds ${String(MAX_PORTFOLIO_ITEMS)} items.`,
          'activeEntryIntents',
          intents.length + 1,
        );
      }
      intents.push(intent);
      break;
    }
    case 'CANCEL_INTENT': {
      const intentId = nonblank(
        readRequiredOwn(raw, 'intentId', 'transition.intentId'),
        'transition.intentId',
      );
      const currentIntent = entryById(intents, intentId);
      if (currentIntent === undefined) {
        invalidState('Cannot cancel an unknown entry intent.', { intentId });
      }
      assertEventSubject(
        currentEvent,
        currentIntent.executionIntent.instrumentId,
        currentIntent.executionIntent.contractId,
      );
      intents = intents.filter(
        ({ executionIntent }) => executionIntent.intentId !== intentId,
      );
      break;
    }
    case 'OPEN_POSITION': {
      const intentId = nonblank(
        readRequiredOwn(raw, 'intentId', 'transition.intentId'),
        'transition.intentId',
      );
      const currentIntent = entryById(intents, intentId);
      if (currentIntent === undefined) {
        invalidState('Cannot open from an unknown entry intent.', { intentId });
      }
      const position = snapshotPositionState(
        readRequiredOwn(raw, 'position', 'transition.position'),
        'transition.position',
        'input',
      );
      if (
        position.executionPosition.intentId !== intentId ||
        position.executionPosition.instrumentId !==
          currentIntent.executionIntent.instrumentId ||
        position.executionPosition.contractId !==
          currentIntent.executionIntent.contractId ||
        position.executionPosition.direction !==
          currentIntent.executionIntent.direction ||
        position.executionPosition.riskDecisionId !==
          currentIntent.executionIntent.riskDecisionId ||
        position.executionPosition.strategyVersion !==
          currentIntent.executionIntent.strategyVersion ||
        position.executionPosition.datasetVersion !==
          currentIntent.executionIntent.datasetVersion ||
        position.executionPosition.signalCloseTime !==
          currentIntent.executionIntent.signalCloseTime ||
        position.executionPosition.signalDecisionAt !==
          currentIntent.executionIntent.signalDecisionAt ||
        !equalDecimal(
          position.executionPosition.protectiveStopPrice,
          currentIntent.executionIntent.stopPrice,
        ) ||
        decimalCompare(
          position.executionPosition.quantity,
          currentIntent.executionIntent.requestedQuantity,
        ) > 0
      ) {
        invalidState('Opened position must match its active intent.');
      }
      assertEventSubject(
        currentEvent,
        position.executionPosition.instrumentId,
        position.executionPosition.contractId,
      );
      if (
        positions.some(
          ({ executionPosition }) =>
            executionPosition.positionId ===
              position.executionPosition.positionId ||
            executionPosition.instrumentId ===
              position.executionPosition.instrumentId,
        )
      ) {
        invalidState('Opened position identity is already active.');
      }
      const accounting = validateCashEntry(
        readRequiredOwn(raw, 'ledgerEntry', 'transition.ledgerEntry'),
        currentEvent,
        readRequiredOwn(raw, 'cashChange', 'transition.cashChange'),
      );
      if (accounting.balancingAccount !== 'COSTS') {
        invalidState('Entry costs must be posted to COSTS.');
      }
      if (
        !equalDecimal(
          accounting.cashChange,
          negate(position.executionPosition.entryCostAccountCurrency),
        )
      ) {
        invalidState('Entry cash change must equal the exact execution cost.');
      }
      ledger = appendLedgerEntry(ledger, accounting.entry);
      intents = intents.filter(
        ({ executionIntent }) => executionIntent.intentId !== intentId,
      );
      if (positions.length >= MAX_PORTFOLIO_ITEMS) {
        limit(
          `positions exceeds ${String(MAX_PORTFOLIO_ITEMS)} items.`,
          'positions',
          positions.length + 1,
        );
      }
      positions.push(position);
      break;
    }
    case 'REVALUE_POSITION': {
      const position = snapshotPositionState(
        readRequiredOwn(raw, 'position', 'transition.position'),
        'transition.position',
        'input',
      );
      const positionId = position.executionPosition.positionId;
      const current = positionById(positions, positionId);
      if (current === undefined) {
        invalidState('Cannot revalue an unknown position.', { positionId });
      }
      assertEventSubject(
        currentEvent,
        position.executionPosition.instrumentId,
        position.executionPosition.contractId,
      );
      if (!sameRevaluationPosition(current, position)) {
        invalidState('Revaluation may only change unrealized P&L.', {
          positionId,
        });
      }
      positions = positions.map((current) =>
        current.executionPosition.positionId === positionId
          ? position
          : current,
      );
      break;
    }
    case 'APPLY_ACCOUNTING': {
      const accounting = validateCashEntry(
        readRequiredOwn(raw, 'ledgerEntry', 'transition.ledgerEntry'),
        currentEvent,
        readRequiredOwn(raw, 'cashChange', 'transition.cashChange'),
      );
      const updatedValue = readRequiredOwn(
        raw,
        'updatedPosition',
        'transition.updatedPosition',
      );
      if (updatedValue === null && accounting.balancingAccount !== 'COSTS') {
        invalidState(
          'Accounting without a remaining position may only post costs.',
        );
      }
      if (updatedValue !== null) {
        const updated = snapshotPositionState(
          updatedValue,
          'transition.updatedPosition',
          'input',
        );
        const positionId = updated.executionPosition.positionId;
        const current = positionById(positions, positionId);
        if (current === undefined) {
          invalidState('Cannot account for an unknown position.', {
            positionId,
          });
        }
        if (!sameAccountingPosition(current, updated)) {
          invalidState(
            'Accounting may not rewrite position identity or entry economics.',
            { positionId },
          );
        }
        assertEventSubject(
          currentEvent,
          current.executionPosition.instrumentId,
          current.executionPosition.contractId,
        );
        positions = positions.map((current) =>
          current.executionPosition.positionId === positionId
            ? updated
            : current,
        );
      }
      ledger = appendLedgerEntry(ledger, accounting.entry);
      break;
    }
    case 'CLOSE_POSITION': {
      const positionId = nonblank(
        readRequiredOwn(raw, 'positionId', 'transition.positionId'),
        'transition.positionId',
      );
      const current = positionById(positions, positionId);
      if (current === undefined) {
        invalidState('Cannot close an unknown position.', { positionId });
      }
      assertEventSubject(
        currentEvent,
        current.executionPosition.instrumentId,
        current.executionPosition.contractId,
      );
      const accounting = validateCashEntry(
        readRequiredOwn(raw, 'ledgerEntry', 'transition.ledgerEntry'),
        currentEvent,
        readRequiredOwn(raw, 'cashChange', 'transition.cashChange'),
      );
      ledger = appendLedgerEntry(ledger, accounting.entry);
      positions = positions.filter(
        ({ executionPosition }) => executionPosition.positionId !== positionId,
      );
      break;
    }
    case 'SET_ENTRY_CAPACITY': {
      operatingStatus = boolean(
        readRequiredOwn(raw, 'available', 'transition.available'),
        'transition.available',
      )
        ? 'RUNNING'
        : 'NO_NEW_ENTRIES';
      break;
    }
    case 'SET_ACTIVE_CONTRACT': {
      const instrumentId = nonblank(
        readRequiredOwn(raw, 'instrumentId', 'transition.instrumentId'),
        'transition.instrumentId',
      );
      const contractId = nullableNonblank(
        readRequiredOwn(raw, 'contractId', 'transition.contractId'),
        'transition.contractId',
      );
      assertEventSubject(currentEvent, instrumentId);
      contracts = sortedActiveContracts(contracts, instrumentId, contractId);
      break;
    }
    case 'RECORD_PORTFOLIO_SNAPSHOT': {
      const snapshotId = nonblank(
        readRequiredOwn(raw, 'snapshotId', 'transition.snapshotId'),
        'transition.snapshotId',
      );
      if (snapshots.length >= MAX_DAILY_SNAPSHOTS) {
        limit(
          `dailySnapshots exceeds ${String(MAX_DAILY_SNAPSHOTS)} items.`,
          'dailySnapshots',
          snapshots.length + 1,
        );
      }
      if (
        snapshots.some(
          (snapshot) =>
            snapshot.snapshotId === snapshotId ||
            snapshot.eventId === currentEvent.semanticId,
        )
      ) {
        invalidState('Daily snapshot identity already exists.', {
          snapshotId,
          eventId: currentEvent.semanticId,
        });
      }
      const aggregates = calculateAggregates(
        base.policy,
        positions,
        intents,
        ledger,
      );
      snapshots.push(
        portfolioSnapshot(
          snapshotId,
          currentEvent,
          operatingStatus,
          base.dailyLoss,
          base.drawdownPct,
          positions,
          intents,
          aggregates,
        ),
      );
      break;
    }
  }

  return assembleState(base, {
    operatingStatus,
    positions,
    activeEntryIntents: intents,
    activeContractByInstrument: contracts,
    dailySnapshots: Object.freeze(snapshots),
    ledger,
    processedEventCount: base.processedEventCount + 1,
    lastClockKey: nextClockKey,
  });
}
