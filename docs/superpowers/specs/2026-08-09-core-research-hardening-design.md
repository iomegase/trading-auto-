# Core Research Milestone Hardening Design

## Objective

Correct the temporal-causality, reproducibility, timeframe-boundary, and exact
stop-price defects found during the post-milestone audit. The correction keeps
the first milestone focused on the research core: market-session calendars,
H1-to-H4 resampling, risk sizing, backtesting, persistence, and execution remain
deferred.

## Confirmed defects

The current public contracts can approve a candidate whose H1 candle is open or
unavailable, whose indicator belongs to another candle or a future instant, and
whose reported H4 close lies after the decision. Raw arrays can also be
unordered, sparse, or contain mixed instruments and timeframes without being
rejected. The full-pipeline causality test accidentally uses H1 fixtures as its
trend series.

The Kijun stop starts from a binary floating-point number, does not accept a
tick size, and therefore cannot satisfy the exact executable-price and
directional-rounding rules. Candidate results omit the dataset version, and
Ichimoku snapshots do not identify their configuration version. Serialized
instants preserve arbitrary offset spelling instead of the canonical UTC
representation required beside the raw provider timestamp.

## Architectural approach

Keep mathematical primitives separate from decision-time orchestration, while
making invalid series and mismatched snapshots impossible to use silently.

```text
validated candles
  -> validate homogeneous chronological series
  -> compute versioned Ichimoku snapshots + exact Kijun price
  -> select strict H4 candle/snapshot available at decisionAt
  -> evaluate structured H4 regime result
  -> validate closed and available H1 decision slice
  -> evaluate candidate with reproducibility context
  -> round exact Kijun stop to tick and revalidate it
```

Existing low-level mathematical functions remain independently testable.
Decision-producing APIs validate the temporal relationships that the low-level
functions cannot infer alone.

## Domain and time contracts

`asInstantString` parses the supplied instant and returns
`Temporal.Instant.from(value).toString()`. Provider-local text remains untouched
in `Candle.sourceTimestamp`; all economic and system instants become canonical
UTC strings.

The domain package exports `DecisionContext` with:

- `decisionAt`
- `signalCandleCloseTime`
- `trendCandleCloseTime`
- `datasetVersion`
- `strategyVersion`

All identifiers and metadata required at runtime must be non-blank after
trimming. The original accepted value is preserved when it is non-blank.

## Series integrity and indicator provenance

`computeIchimoku` validates before calculation that its input is dense and that
all candles:

- belong to one instrument;
- use one timeframe;
- are ordered by strictly increasing economic `closeTime`;
- do not overlap their predecessor.

The function does not require every candle to be available at one global
decision instant because it also builds research histories. Instead, every
snapshot carries enough provenance for a decision boundary to verify it:

- `instrumentId`
- `timeframe`
- `candleCloseTime`
- `computedAt`
- `configVersion`

`computedAt` is the latest `availableAt` among the prefix used through that
index. This prevents a late historical candle from being concealed behind the
current candle's earlier availability timestamp.

Ichimoku retains its research `number | null` fields and additionally exposes
`kijunPrice: DecimalString | null`, calculated directly from the source decimal
highs and lows with an isolated Decimal constructor. This exact field is the
only Kijun representation accepted by the stop proposal.

`IchimokuConfig` gains a required non-blank `version`. The version is copied to
every snapshot. Numeric configuration fields keep their positive-safe-integer
validation.

## Strict H4 boundary

The calendars package adds an H4-specific selection result. It receives an
instrument identifier, a decision instant, H4 candles, and their aligned
Ichimoku snapshots. It validates one-to-one candle/snapshot provenance and only
selects entries satisfying:

```text
candle.timeframe = 4h
candle.instrumentId = requested instrument
candle.isClosed = true
candle.availableAt <= decisionAt
snapshot.computedAt <= decisionAt
snapshot.candleCloseTime = candle.closeTime
```

Before an H4 snapshot is computed or selected, every candle through its close
must itself be closed and available by `decisionAt`. Later candles that close
before the decision but are published afterward are excluded before numeric
indicator conversion, so unavailable extreme values cannot change or abort a
decision at `T`.

The result is a discriminated union:

- `SELECTED`, carrying the candle and point;
- `UNAVAILABLE`, carrying `NO_CLOSED_TREND_CANDLE` when no closed H4 candle is
  eligible;
- `UNAVAILABLE`, carrying `INSUFFICIENT_DATA` when a candle is eligible but its
  indicator data is not yet complete or available.

The existing generic selector remains available for generic calendar use, but
the strategy pipeline and causality test use only the strict H4 selector.

## Strategy decision boundary

`evaluateH4Regime` rejects non-H4 candles, invalid cloud directions, and
snapshot/candle provenance mismatches. Its mathematical regime remains
`BULLISH | BEARISH | NEUTRAL | INSUFFICIENT_DATA`; the strict H4 selection layer
preserves absence reasons.

`evaluateH1Candidate` requires `datasetVersion` and validates that:

- the current candle is H1, closed, and available by `decisionAt`;
- its close is not after `decisionAt`;
- the supplied snapshot belongs to the same instrument, timeframe, and close;
- `snapshot.computedAt <= decisionAt`;
- `trendCandleCloseTime <= decisionAt`;
- every candle used by the breakout window belongs to the same H1 series, is
  closed, and is available by `decisionAt`.

Temporal or provenance mismatches are programmer/input errors and throw a clear
`RangeError`. Missing history remains an expected `INSUFFICIENT_DATA` result.
Candidate results expose the complete `DecisionContext` fields plus
`indicatorConfigVersion`, stable reasons, and immutable output.

The breakout primitive validates dense, homogeneous, chronologically ordered
windows. The candidate boundary adds decision-time availability checks because
the primitive has no clock parameter.

The package adds `evaluateIchimokuDecision` as the sole public API capable of
producing an approved decision. It accepts the H1 and H4 candle series, their
versioned indicator configuration, the signal index, direction, decision time,
breakout lookback, dataset and strategy versions, entry reference, and tick
size. It computes the aligned snapshots, performs strict H4 selection, derives
the regime, evaluates the H1 filters, and proposes the exact stop in one causal
flow.

The result is a discriminated union:

- `UNAVAILABLE` with `NO_CLOSED_TREND_CANDLE` or `INSUFFICIENT_DATA`, before any
  approval can be emitted;
- `APPROVED` or `REJECTED` with the full decision context, indicator config
  version, stable candidate reasons, and stop proposal.

Low-level regime, breakout, and candidate modules remain directly testable
inside the package, but the raw candidate evaluator is removed from the public
barrel. This prevents consumers from bypassing H4 selection or substituting an
unbound regime value.

Programmer/input validation is branch-independent: H1 closure and availability,
lookback, entry reference, and tick size are checked before the pipeline may
return an expected H4 `UNAVAILABLE` result.

## Exact tick-aligned stop

The stop API becomes:

```ts
proposeKijunStop(
  direction: 'LONG' | 'SHORT',
  kijunPrice: DecimalString | null,
  entryReference: DecimalString,
  tickSize: DecimalString,
): StopProposal
```

All three decimal inputs must represent strictly positive values. Invalid or
missing Kijun values return `INVALID_INITIAL_STOP`; invalid entry or tick inputs
are programmer/input errors.

Using the isolated strategy Decimal constructor:

- LONG rounds the Kijun quotient upward to the next tick;
- SHORT rounds the quotient downward to the previous tick;
- the rounded price is converted to canonical non-exponential decimal text;
- the rounded stop is revalidated strictly below LONG entry or strictly above
  SHORT entry.

Sizing, cost allowance, and fill-time stop recalculation remain part of the
next milestone.

## Testing

Every production behavior change follows red-green-refactor. New tests cover:

- UTC normalization and equivalent instant spellings;
- blank metadata rejection;
- sparse, unordered, overlapping, mixed-instrument, and mixed-timeframe series;
- late historical availability reflected in `computedAt`;
- version propagation and exact Kijun midpoint;
- strict H4 selection at inside, boundary, delayed, incomplete-indicator, and
  wrong-instrument/timeframe cases;
- unfinished/unavailable H1, future/mismatched snapshot, and future trend time;
- unavailable breakout constituents;
- exact directional tick rounding and post-rounding stop validation;
- a full causality test using distinct real H1 and H4 timeframes with a future
  shock and delayed availability, exercised through
  `evaluateIchimokuDecision`.

The final gate is `pnpm check`, `pnpm test:coverage`, frozen-lockfile install,
dependency audit, and a whole-milestone code review.

## Explicit exclusions

This hardening does not add exchange-session calendars, DST/holiday logic,
H1-to-H4 aggregation, risk sizing, capital enforcement, transaction costs,
fills, exits, persistence, UI, brokers, paper trading, or live execution.
