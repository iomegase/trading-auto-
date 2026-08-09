import {
  assertCandleSeries,
  asInstantString,
  type Candle,
  type InstantString,
} from '@trading-auto/domain';
import type { IchimokuPoint } from '@trading-auto/indicators';
import { Temporal } from '@js-temporal/polyfill';

import { detectBreakout } from './breakout.js';
import { StrategyDecimal } from './decimal.js';
import type { MarketRegime } from './regime.js';

export type CandidateDirection = 'LONG' | 'SHORT';

export type CandidateReason =
  | 'INSUFFICIENT_DATA'
  | 'TREND_NOT_BULLISH'
  | 'TREND_NOT_BEARISH'
  | 'PRICE_NOT_ABOVE_CURRENT_KUMO'
  | 'PRICE_NOT_BELOW_CURRENT_KUMO'
  | 'KIJUN_SLOPE_NOT_POSITIVE'
  | 'KIJUN_SLOPE_NOT_NEGATIVE'
  | 'BREAKOUT_NOT_CONFIRMED';

export interface H1CandidateInput {
  readonly direction: CandidateDirection;
  readonly regime: MarketRegime;
  readonly candles: readonly Candle[];
  readonly index: number;
  readonly indicator: IchimokuPoint;
  readonly breakoutLookback: number;
  readonly decisionAt: InstantString;
  readonly trendCandleCloseTime: InstantString;
  readonly strategyVersion: string;
  readonly datasetVersion: string;
}

interface H1CandidateResultFields {
  readonly direction: CandidateDirection;
  readonly decisionAt: InstantString;
  readonly signalCandleCloseTime: InstantString;
  readonly trendCandleCloseTime: InstantString;
  readonly strategyVersion: string;
  readonly datasetVersion: string;
  readonly indicatorConfigVersion: string;
  readonly reasons: readonly CandidateReason[];
}

export type H1CandidateResult =
  | (H1CandidateResultFields & { readonly status: 'APPROVED' })
  | (H1CandidateResultFields & { readonly status: 'REJECTED' });

function assertFinite(value: number | null, field: string): void {
  if (value !== null && !Number.isFinite(value)) {
    throw new RangeError(`${field} must be finite.`);
  }
}

function assertDirection(value: unknown): asserts value is CandidateDirection {
  if (value !== 'LONG' && value !== 'SHORT') {
    throw new RangeError('direction must be LONG or SHORT.');
  }
}

function assertRegime(value: unknown): asserts value is MarketRegime {
  if (
    value !== 'BULLISH' &&
    value !== 'BEARISH' &&
    value !== 'NEUTRAL' &&
    value !== 'INSUFFICIENT_DATA'
  ) {
    throw new RangeError(
      'regime must be BULLISH, BEARISH, NEUTRAL, or INSUFFICIENT_DATA.',
    );
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

function assertNotAfter(
  value: InstantString,
  upperBound: InstantString,
  field: string,
): void {
  if (Temporal.Instant.compare(value, upperBound) > 0) {
    throw new RangeError(`${field} must not be after decisionAt.`);
  }
}

function candleAt(candles: readonly Candle[], index: number): Candle {
  const candle = candles[index];

  if (candle === undefined) {
    throw new RangeError(`Expected a candle at index ${String(index)}.`);
  }

  return candle;
}

export function evaluateH1Candidate(
  input: Readonly<H1CandidateInput>,
): Readonly<H1CandidateResult> {
  if (
    !Number.isSafeInteger(input.index) ||
    input.index < 0 ||
    input.index >= input.candles.length
  ) {
    throw new RangeError(
      'index must be a safe integer within the candle array.',
    );
  }

  assertDirection(input.direction);
  assertRegime(input.regime);

  assertNonBlank(input.strategyVersion, 'strategyVersion');
  assertNonBlank(input.datasetVersion, 'datasetVersion');
  assertNonBlank(input.indicator.configVersion, 'indicator.configVersion');

  const decisionAt = asInstantString(input.decisionAt);
  const trendCandleCloseTime = asInstantString(input.trendCandleCloseTime);
  assertNotAfter(trendCandleCloseTime, decisionAt, 'trendCandleCloseTime');

  assertCandleSeries(input.candles, { timeframe: '1h' });
  const signalCandle = candleAt(input.candles, input.index);
  const signalCloseTime = asInstantString(signalCandle.closeTime);
  const signalAvailableAt = asInstantString(signalCandle.availableAt);

  if (!signalCandle.isClosed) {
    throw new RangeError('The H1 signal candle must be closed.');
  }

  assertNotAfter(signalCloseTime, decisionAt, 'signal candle closeTime');
  assertNotAfter(signalAvailableAt, decisionAt, 'signal candle availableAt');

  if (input.indicator.instrumentId !== signalCandle.instrumentId) {
    throw new RangeError(
      'indicator instrumentId must match the signal candle instrumentId.',
    );
  }

  if (input.indicator.timeframe !== signalCandle.timeframe) {
    throw new RangeError(
      'indicator timeframe must match the signal candle timeframe.',
    );
  }

  const indicatorCandleCloseTime = asInstantString(
    input.indicator.candleCloseTime,
  );
  const indicatorComputedAt = asInstantString(input.indicator.computedAt);

  if (
    Temporal.Instant.compare(indicatorCandleCloseTime, signalCloseTime) !== 0
  ) {
    throw new RangeError(
      'indicator candleCloseTime must match the signal candle closeTime.',
    );
  }

  assertNotAfter(indicatorComputedAt, decisionAt, 'indicator computedAt');

  for (let candleIndex = 0; candleIndex <= input.index; candleIndex += 1) {
    const prefixCandle = candleAt(input.candles, candleIndex);

    if (!prefixCandle.isClosed) {
      throw new RangeError(
        `Indicator prefix candle ${String(candleIndex)} must be closed.`,
      );
    }

    const availableAt = asInstantString(prefixCandle.availableAt);

    if (Temporal.Instant.compare(availableAt, decisionAt) > 0) {
      throw new RangeError(
        `Indicator prefix candle ${String(candleIndex)} availableAt must not be after decisionAt.`,
      );
    }
  }

  const { currentCloudTop, currentCloudBottom, kijunSlope } = input.indicator;

  assertFinite(currentCloudTop, 'currentCloudTop');
  assertFinite(currentCloudBottom, 'currentCloudBottom');
  assertFinite(kijunSlope, 'kijunSlope');

  const breakout = detectBreakout(
    input.candles,
    input.index,
    input.breakoutLookback,
  );

  const reasons: CandidateReason[] = [];
  const requiredCloud =
    input.direction === 'LONG' ? currentCloudTop : currentCloudBottom;

  if (
    input.regime === 'INSUFFICIENT_DATA' ||
    requiredCloud === null ||
    kijunSlope === null ||
    breakout.status === 'INSUFFICIENT_DATA'
  ) {
    reasons.push('INSUFFICIENT_DATA');
  }

  if (
    input.regime !== 'INSUFFICIENT_DATA' &&
    input.regime !== (input.direction === 'LONG' ? 'BULLISH' : 'BEARISH')
  ) {
    reasons.push(
      input.direction === 'LONG' ? 'TREND_NOT_BULLISH' : 'TREND_NOT_BEARISH',
    );
  }

  if (requiredCloud !== null) {
    const close = new StrategyDecimal(signalCandle.close);
    const cloud = new StrategyDecimal(requiredCloud);
    const priceConditionPasses =
      input.direction === 'LONG' ? close.gt(cloud) : close.lt(cloud);

    if (!priceConditionPasses) {
      reasons.push(
        input.direction === 'LONG'
          ? 'PRICE_NOT_ABOVE_CURRENT_KUMO'
          : 'PRICE_NOT_BELOW_CURRENT_KUMO',
      );
    }
  }

  if (kijunSlope !== null) {
    const slopeConditionPasses =
      input.direction === 'LONG' ? kijunSlope > 0 : kijunSlope < 0;

    if (!slopeConditionPasses) {
      reasons.push(
        input.direction === 'LONG'
          ? 'KIJUN_SLOPE_NOT_POSITIVE'
          : 'KIJUN_SLOPE_NOT_NEGATIVE',
      );
    }
  }

  if (
    breakout.status !== 'INSUFFICIENT_DATA' &&
    breakout.status !== input.direction
  ) {
    reasons.push('BREAKOUT_NOT_CONFIRMED');
  }

  const frozenReasons = Object.freeze(reasons);

  return Object.freeze({
    status: frozenReasons.length === 0 ? 'APPROVED' : 'REJECTED',
    direction: input.direction,
    decisionAt,
    signalCandleCloseTime: signalCloseTime,
    trendCandleCloseTime,
    strategyVersion: input.strategyVersion,
    datasetVersion: input.datasetVersion,
    indicatorConfigVersion: input.indicator.configVersion,
    reasons: frozenReasons,
  });
}
