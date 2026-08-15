import { Temporal } from '@js-temporal/polyfill';
import {
  asInstantString,
  type CurrencyCode,
  type DecimalString,
  type InstantString,
} from '@trading-auto/domain';
import type { EntryIntent, OpenPosition } from '@trading-auto/execution';
import {
  calculateSizingEquity,
  createRiskAccountState,
  createRiskPolicy,
  type ActiveEntryIntent,
  type RiskPolicyInput,
  type RiskPolicyVersion,
  type RiskPosition,
} from '@trading-auto/risk';

import { BacktestInputError } from './errors.js';
import { createInitialLedger, type BacktestLedger } from './ledger.js';
import {
  readRequiredOwn,
  snapshotPlainRecord,
  snapshotSelectedOwn,
} from './validation.js';

export type BacktestOperatingStatus = 'RUNNING' | 'NO_NEW_ENTRIES';

export interface BacktestPositionState {
  readonly executionPosition: OpenPosition;
  readonly riskPosition: RiskPosition;
  readonly unrealizedPnl: DecimalString;
}

export interface BacktestIntentState {
  readonly executionIntent: EntryIntent;
  readonly riskIntent: ActiveEntryIntent;
  readonly reservedMargin: DecimalString;
  readonly reservedOpenRisk: DecimalString;
  readonly reservedGrossExposure: DecimalString;
  readonly riskGroup: string;
}

export interface BacktestDailyPortfolioSnapshot {
  readonly snapshotId: string;
  readonly eventId: string;
  readonly recordedAt: InstantString;
  readonly operatingStatus: BacktestOperatingStatus;
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
  readonly dailyLoss: DecimalString;
  readonly drawdownPct: DecimalString;
  readonly positionCount: number;
  readonly activeIntentCount: number;
}

export interface BacktestPortfolioStateInput {
  backtestId: string;
  runCreatedAt: string;
  riskPolicyUseMode: string;
  riskPolicyUseAt: string;
  policy: Readonly<RiskPolicyInput>;
}

export interface BacktestPortfolioState {
  readonly backtestId: string;
  readonly runCreatedAt: InstantString;
  readonly riskPolicyUseMode: 'HISTORICAL_RESEARCH';
  readonly riskPolicyUseAt: InstantString;
  readonly riskPolicyVersion: string;
  readonly maxSizingCapital: DecimalString;
  readonly policy: RiskPolicyVersion;
  readonly operatingStatus: BacktestOperatingStatus;
  readonly accountCurrency: CurrencyCode;
  readonly initialCash: DecimalString;
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
  readonly dailyLoss: DecimalString;
  readonly drawdownPct: DecimalString;
  readonly positions: readonly BacktestPositionState[];
  readonly activeEntryIntents: readonly BacktestIntentState[];
  readonly riskGroupExposure: Readonly<Record<string, DecimalString>>;
  readonly activeContractByInstrument: Readonly<Record<string, string>>;
  readonly dailySnapshots: readonly BacktestDailyPortfolioSnapshot[];
  readonly ledger: BacktestLedger;
  readonly processedEventCount: number;
  readonly lastClockKey: string | null;
}

const INPUT_FIELDS = Object.freeze([
  'backtestId',
  'runCreatedAt',
  'riskPolicyUseMode',
  'riskPolicyUseAt',
  'policy',
] as const);

const POLICY_FIELDS = Object.freeze([
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
] as const satisfies readonly (keyof RiskPolicyInput)[]);

function invalid(message: string, field: string, value?: unknown): never {
  throw new BacktestInputError('INVALID_BACKTEST_INPUT', message, {
    field,
    value,
  });
}

function nonblank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${field} must be a nonblank string.`, field, value);
  }
  return value;
}

function instant(value: unknown, field: string): InstantString {
  if (typeof value !== 'string') {
    invalid(`${field} must be an ISO instant.`, field, value);
  }
  try {
    return asInstantString(value);
  } catch {
    invalid(`${field} must be an ISO instant.`, field, value);
  }
}

function historicalResearch(value: unknown): 'HISTORICAL_RESEARCH' {
  if (value !== 'HISTORICAL_RESEARCH') {
    invalid(
      'riskPolicyUseMode must be HISTORICAL_RESEARCH.',
      'riskPolicyUseMode',
      value,
    );
  }
  return value;
}

function capturePolicy(value: unknown): RiskPolicyInput {
  const snapshot = snapshotSelectedOwn(value, 'policy', POLICY_FIELDS);
  const result = Object.fromEntries(
    POLICY_FIELDS.map((field) => [
      field,
      readRequiredOwn(snapshot, field, `policy.${field}`),
    ]),
  ) as unknown as RiskPolicyInput;
  Object.defineProperty(result, 'riskGroupMaxExposurePct', {
    configurable: false,
    enumerable: true,
    value: snapshotPlainRecord(
      readRequiredOwn(
        snapshot,
        'riskGroupMaxExposurePct',
        'policy.riskGroupMaxExposurePct',
      ),
      'policy.riskGroupMaxExposurePct',
    ),
    writable: false,
  });
  return result;
}

export function snapshotRiskPolicy(value: unknown): RiskPolicyVersion {
  const captured = capturePolicy(value);
  try {
    return createRiskPolicy(captured);
  } catch {
    invalid('policy must be a valid approved risk policy.', 'policy');
  }
}

function initialSizingEquity(policy: RiskPolicyVersion): DecimalString {
  return calculateSizingEquity(
    createRiskAccountState({
      accountCurrency: policy.accountCurrency,
      realizedEquity: policy.initialCapital,
      unrealizedPnl: '0',
      availableFunds: policy.initialCapital,
      usedMargin: '0',
      grossExposure: '0',
      openRisk: '0',
      dailyLoss: '0',
      drawdownPct: '0',
      killSwitchActive: false,
    }),
    policy,
  );
}

function initialRiskGroupExposure(
  policy: RiskPolicyVersion,
): Readonly<Record<string, DecimalString>> {
  const result: Record<string, DecimalString> = Object.create(null) as Record<
    string,
    DecimalString
  >;
  for (const riskGroup of Object.keys(policy.riskGroupMaxExposurePct)) {
    Object.defineProperty(result, riskGroup, {
      configurable: false,
      enumerable: true,
      value: '0',
      writable: false,
    });
  }
  return Object.freeze(result);
}

export function createBacktestPortfolioState(
  input: BacktestPortfolioStateInput,
): BacktestPortfolioState {
  const snapshot = snapshotSelectedOwn(input, 'input', INPUT_FIELDS);
  const backtestId = nonblank(
    readRequiredOwn(snapshot, 'backtestId', 'backtestId'),
    'backtestId',
  );
  const runCreatedAt = instant(
    readRequiredOwn(snapshot, 'runCreatedAt', 'runCreatedAt'),
    'runCreatedAt',
  );
  const riskPolicyUseMode = historicalResearch(
    readRequiredOwn(snapshot, 'riskPolicyUseMode', 'riskPolicyUseMode'),
  );
  const riskPolicyUseAt = instant(
    readRequiredOwn(snapshot, 'riskPolicyUseAt', 'riskPolicyUseAt'),
    'riskPolicyUseAt',
  );
  if (riskPolicyUseAt !== runCreatedAt) {
    invalid(
      'riskPolicyUseAt must equal runCreatedAt.',
      'riskPolicyUseAt',
      riskPolicyUseAt,
    );
  }

  const policy = snapshotRiskPolicy(
    readRequiredOwn(snapshot, 'policy', 'policy'),
  );
  if (
    Temporal.Instant.compare(
      Temporal.Instant.from(policy.activatedAt),
      Temporal.Instant.from(runCreatedAt),
    ) > 0
  ) {
    invalid(
      'policy activatedAt must not follow runCreatedAt.',
      'policy.activatedAt',
      policy.activatedAt,
    );
  }

  const emptyArray = Object.freeze([]);
  const emptyRecord = Object.freeze(Object.create(null)) as Readonly<
    Record<string, string>
  >;
  const sizingEquity = initialSizingEquity(policy);

  return Object.freeze({
    backtestId,
    runCreatedAt,
    riskPolicyUseMode,
    riskPolicyUseAt,
    riskPolicyVersion: policy.version,
    maxSizingCapital: policy.maxSizingCapital,
    policy,
    operatingStatus: 'RUNNING',
    accountCurrency: policy.accountCurrency,
    initialCash: policy.initialCapital,
    cash: policy.initialCapital,
    realizedEquity: policy.initialCapital,
    unrealizedPnl: '0' as DecimalString,
    sizingEquity,
    usedMargin: '0' as DecimalString,
    reservedMargin: '0' as DecimalString,
    availableFunds: policy.initialCapital,
    grossExposure: '0' as DecimalString,
    reservedGrossExposure: '0' as DecimalString,
    openRisk: '0' as DecimalString,
    dailyLoss: '0' as DecimalString,
    drawdownPct: '0' as DecimalString,
    positions: emptyArray,
    activeEntryIntents: emptyArray,
    riskGroupExposure: initialRiskGroupExposure(policy),
    activeContractByInstrument: emptyRecord,
    dailySnapshots: emptyArray,
    ledger: createInitialLedger({ backtestId, runCreatedAt }),
    processedEventCount: 0,
    lastClockKey: null,
  });
}
