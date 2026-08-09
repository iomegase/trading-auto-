import { Temporal } from '@js-temporal/polyfill';
import { selectLatestAvailableH4Snapshot } from '@trading-auto/calendars';
import {
  asInstantString,
  assertCandleSeries,
  type Candle,
  type DecimalString,
  type DecisionContext,
  type InstantString,
} from '@trading-auto/domain';
import {
  computeIchimoku,
  type IchimokuConfig,
  type IchimokuPoint,
} from '@trading-auto/indicators';

import {
  evaluateH1Candidate,
  type CandidateDirection,
  type CandidateReason,
} from './candidate.js';
import { evaluateH4Regime, type MarketRegime } from './regime.js';
import { proposeKijunStop, type StopProposal } from './stop.js';

export type IchimokuDecisionDirection = CandidateDirection;
export type IchimokuDecisionReason = CandidateReason | 'INVALID_INITIAL_STOP';

export interface IchimokuDecisionInput {
  readonly direction: IchimokuDecisionDirection;
  readonly h1Candles: readonly Candle[];
  readonly h4Candles: readonly Candle[];
  readonly signalIndex: number;
  readonly indicatorConfig: Readonly<IchimokuConfig>;
  readonly breakoutLookback: number;
  readonly decisionAt: InstantString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
  readonly entryReference: DecimalString;
  readonly tickSize: DecimalString;
}

interface UnavailableDecision {
  readonly status: 'UNAVAILABLE';
  readonly reason: 'NO_CLOSED_TREND_CANDLE' | 'INSUFFICIENT_DATA';
  readonly direction: IchimokuDecisionDirection;
  readonly decisionAt: InstantString;
  readonly signalCandleCloseTime: InstantString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
  readonly indicatorConfigVersion: string;
}

interface EvaluatedDecisionFields extends DecisionContext {
  readonly direction: IchimokuDecisionDirection;
  readonly regime: MarketRegime;
  readonly indicatorConfigVersion: string;
  readonly reasons: readonly IchimokuDecisionReason[];
}

interface ApprovedDecision extends EvaluatedDecisionFields {
  readonly status: 'APPROVED';
  readonly stop: Extract<StopProposal, { readonly status: 'VALID' }>;
}

interface RejectedDecision extends EvaluatedDecisionFields {
  readonly status: 'REJECTED';
  readonly stop: StopProposal;
}

export type IchimokuDecisionResult =
  UnavailableDecision | ApprovedDecision | RejectedDecision;

function assertDirection(
  value: unknown,
): asserts value is IchimokuDecisionDirection {
  if (value !== 'LONG' && value !== 'SHORT') {
    throw new RangeError('direction must be LONG or SHORT.');
  }
}

function assertNonBlank(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RangeError(`${field} must be a non-blank string.`);
  }
}

function itemAt<T>(items: readonly T[], index: number, field: string): T {
  const item = items[index];

  if (item === undefined) {
    throw new RangeError(`Expected ${field} at index ${String(index)}.`);
  }

  return item;
}

function assertSignalIndex(index: number, length: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    throw new RangeError(
      'signalIndex must be a safe integer within the H1 candle array.',
    );
  }
}

function causalH4Prefix(
  candles: readonly Candle[],
  decisionAt: InstantString,
): readonly Candle[] {
  let prefixLength = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = itemAt(candles, index, 'an H4 candle');

    if (Temporal.Instant.compare(candle.closeTime, decisionAt) > 0) {
      break;
    }

    prefixLength = index + 1;
  }

  return candles.slice(0, prefixLength);
}

function frozenStop(stop: StopProposal): Readonly<StopProposal> {
  return Object.freeze({ ...stop });
}

function unavailableResult(
  input: Readonly<IchimokuDecisionInput>,
  decisionAt: InstantString,
  signalCandle: Candle,
  signalPoint: IchimokuPoint,
  reason: UnavailableDecision['reason'],
): Readonly<UnavailableDecision> {
  return Object.freeze({
    status: 'UNAVAILABLE',
    reason,
    direction: input.direction,
    decisionAt,
    signalCandleCloseTime: signalCandle.closeTime,
    datasetVersion: input.datasetVersion,
    strategyVersion: input.strategyVersion,
    indicatorConfigVersion: signalPoint.configVersion,
  });
}

export function evaluateIchimokuDecision(
  input: Readonly<IchimokuDecisionInput>,
): Readonly<IchimokuDecisionResult> {
  assertDirection(input.direction);
  assertNonBlank(input.datasetVersion, 'datasetVersion');
  assertNonBlank(input.strategyVersion, 'strategyVersion');

  const decisionAt = asInstantString(input.decisionAt);
  assertCandleSeries(input.h1Candles, { timeframe: '1h' });
  assertSignalIndex(input.signalIndex, input.h1Candles.length);

  const signalCandle = itemAt(
    input.h1Candles,
    input.signalIndex,
    'an H1 signal candle',
  );
  const h1Prefix = input.h1Candles.slice(0, input.signalIndex + 1);
  const signalPoints = computeIchimoku(h1Prefix, input.indicatorConfig);
  const signalPoint = itemAt(
    signalPoints,
    input.signalIndex,
    'an H1 Ichimoku point',
  );

  assertCandleSeries(input.h4Candles, {
    instrumentId: signalCandle.instrumentId,
    timeframe: '4h',
  });
  const h4Candles = causalH4Prefix(input.h4Candles, decisionAt);
  const h4Points = computeIchimoku(h4Candles, input.indicatorConfig);
  const selection = selectLatestAvailableH4Snapshot(
    h4Candles,
    h4Points,
    decisionAt,
    signalCandle.instrumentId,
  );

  if (selection.status === 'UNAVAILABLE') {
    return unavailableResult(
      input,
      decisionAt,
      signalCandle,
      signalPoint,
      selection.reason,
    );
  }

  const regime = evaluateH4Regime(selection.candle, selection.point);
  const candidate = evaluateH1Candidate({
    direction: input.direction,
    regime,
    candles: input.h1Candles,
    index: input.signalIndex,
    indicator: signalPoint,
    breakoutLookback: input.breakoutLookback,
    decisionAt,
    trendCandleCloseTime: selection.candle.closeTime,
    strategyVersion: input.strategyVersion,
    datasetVersion: input.datasetVersion,
  });
  const stop = frozenStop(
    proposeKijunStop(
      input.direction,
      signalPoint.kijunPrice,
      input.entryReference,
      input.tickSize,
    ),
  );
  const reasons: IchimokuDecisionReason[] = [...candidate.reasons];

  if (stop.status === 'INVALID_INITIAL_STOP') {
    reasons.push('INVALID_INITIAL_STOP');
  }

  const frozenReasons = Object.freeze(reasons);
  const common = {
    direction: input.direction,
    regime,
    decisionAt: candidate.decisionAt,
    signalCandleCloseTime: candidate.signalCandleCloseTime,
    trendCandleCloseTime: candidate.trendCandleCloseTime,
    datasetVersion: candidate.datasetVersion,
    strategyVersion: candidate.strategyVersion,
    indicatorConfigVersion: candidate.indicatorConfigVersion,
    reasons: frozenReasons,
  } as const;

  if (candidate.status === 'APPROVED' && stop.status === 'VALID') {
    return Object.freeze({ status: 'APPROVED', ...common, stop });
  }

  return Object.freeze({ status: 'REJECTED', ...common, stop });
}
