# Core Research Milestone Design

## Objective

Build the first independently testable slice of the Trading Auto V1 research engine. The milestone covers domain primitives, temporal alignment, Ichimoku calculations, H4 regime evaluation, H1 candidate generation, breakout detection, and the initial Kijun stop proposal. It does not include risk sizing, backtesting, persistence, UI, paper execution, or broker integration.

## Source of truth

The implementation follows the specifications in `specs/`, with particular emphasis on:

- `04-DOMAIN-MODEL.md`
- `05-MARKET-DATA-SPEC.md`
- `06-TIMEFRAME-ALIGNMENT-SPEC.md`
- `07-ICHIMOKU-INDICATOR-SPEC.md`
- `08-STRATEGY-SPEC.md`
- `10-STOP-EXIT-SPEC.md`
- `17-TEST-PLAN.md`
- `24-CODEX-PROMPT.md`

When an implementation choice is not specified, the milestone must choose the smallest deterministic behavior and document it in tests. Open broker, instrument, cost, margin, and statistical-validation questions remain outside this milestone.

## Architecture choice

Use a pnpm workspace with TypeScript project references. This preserves the package boundaries required by the specifications without introducing a task orchestrator before build scale requires one.

The workspace contains:

```text
packages/
  domain/
  calendars/
  indicators/
  strategy-ichimoku/
  test-helpers/
```

Package responsibilities:

- `@trading-auto/domain`: shared branded types, canonical decimal strings and UTC instants, candles, decision context, series validation, and validation errors.
- `@trading-auto/calendars`: availability predicates and strict selection of an aligned closed H4 candle/snapshot pair. Full exchange calendars and H1-to-H4 resampling are deferred until instrument sessions are chosen.
- `@trading-auto/indicators`: versioned Ichimoku calculations with provenance, exact Kijun prices, and explicit raw, projected, and currently visible cloud values.
- `@trading-auto/strategy-ichimoku`: breakout, H4 regime, internal H1 candidate evaluation, exact tick-aligned Kijun stops, and the sole public approval pipeline. It depends on the public domain, calendar, and indicator contracts.
- `@trading-auto/test-helpers`: deterministic candle builders and synthetic datasets used across package tests.

No strategy formula belongs in a future Next.js application. The same package APIs will be consumed later by both the backtester and the real-time engine.

## Dependency policy

Production dependencies are intentionally limited:

- `decimal.js` for executable prices, monetary values, quantities, and exact decimal comparisons.
- `zod` specifically for strict Ichimoku configuration parsing in the indicators package. Domain candle and series boundaries use explicit guards so validation errors retain their stable domain codes.
- `@js-temporal/polyfill` for unambiguous instants, time zones, and later session-aware calendar operations.

Development dependencies:

- `typescript` with strict compiler settings and project references.
- `vitest` and `@vitest/coverage-v8` for unit, boundary, and causality tests.
- `eslint`, `@eslint/js`, and `typescript-eslint` for static analysis.
- `prettier` for deterministic formatting.
- `@types/node` for the Node.js environment.

Node.js `>=22.15.0` and pnpm 10 are the supported local baseline. Dependency versions are locked in `pnpm-lock.yaml`. Next.js, databases, Redis, Prisma, broker SDKs, and Turborepo are excluded from this milestone.

## Domain representation

External and persisted decimal values use a canonical `DecimalString` type. Runtime constructors validate that values are finite canonical decimal strings. Business calculations that affect money, executable prices, or quantities use `Decimal`; indicator calculations may use JavaScript numbers after validation because the specifications allow binary floating point for research indicators that do not directly determine executable monetary values.

Time values use `Temporal.Instant` at runtime and canonical UTC strings at serialization boundaries. Provider-local source text remains separate in `sourceTimestamp`. Candle validation enforces:

- `openTime < closeTime`
- `availableAt >= closeTime` for an `ON_CLOSE` candle
- `high >= max(open, close)`
- `low <= min(open, close)`
- `high >= low`
- strictly positive prices

Invalid input returns or throws a typed domain validation error at construction time; downstream indicator and strategy functions only accept validated candles.

## Data flow

The first milestone implements this deterministic pipeline:

```text
validated homogeneous H1/H4 candle series
  -> compute versioned Ichimoku snapshots on causal prefixes
  -> select latest aligned H4 candle/snapshot available at decisionAt
  -> evaluate H4 regime
  -> compute H1 breakout against previous N candles only
  -> evaluate H1 candidate with structured reasons
  -> round the exact Kijun stop to the instrument tick
```

Each function is pure. Inputs contain every timestamp and parameter required for a decision; there is no global clock, mutable cache, database, or network dependency.

## Temporal and Ichimoku invariants

The indicator engine stores calculated values at their calculation index. It does not shift arrays for chart display.

For index `t`:

```text
projectedSenkouA[t] = senkouARaw[t]
projectedSenkouB[t] = senkouBRaw[t]
currentCloudA[t] = senkouARaw[t - displacement]
currentCloudB[t] = senkouBRaw[t - displacement]
```

The first complete current cloud with parameters 9/26/52 and displacement 26 is at index 77. Earlier evaluations requiring a complete Kumo return `INSUFFICIENT_DATA`.

A trend snapshot is eligible only when its H4 candle is closed and available,
its own `computedAt <= decisionAt`, and its instrument, timeframe, and close
match that candle. A breakout at index `t` compares `close[t]` with highs or
lows in `[t-N, t-1]`; the current candle is never part of its own comparison
window. Every H1 candle used at the decision boundary must also be closed and
available by `decisionAt`. The public pipeline validates all H1 and stop inputs
before returning an expected H4-unavailability result. It identifies the latest
metadata-eligible H4 candle before numerical conversion, rejects an incomplete
historical prefix, and never computes a candle whose data is not yet available.

## Strategy results and errors

Expected absence of sufficient history is a normal domain result, not an exception. Regime and candidate functions return discriminated unions with structured reason codes, including:

- `INSUFFICIENT_DATA`
- `NO_CLOSED_TREND_CANDLE`
- `TREND_NOT_BULLISH`
- `TREND_NOT_BEARISH`
- `PRICE_NOT_ABOVE_CURRENT_KUMO`
- `PRICE_NOT_BELOW_CURRENT_KUMO`
- `KIJUN_SLOPE_NOT_POSITIVE`
- `KIJUN_SLOPE_NOT_NEGATIVE`
- `BREAKOUT_NOT_CONFIRMED`
- `INVALID_INITIAL_STOP`

Exceptions are reserved for programmer errors or invalid construction input.
`evaluateIchimokuDecision` is the only public function that can return
`APPROVED`; the raw candidate evaluator is internal so H4 selection cannot be
bypassed. Evaluated decisions include the decision timestamp, H1 and H4 close
timestamps, dataset and strategy versions, Ichimoku configuration version,
regime, exact stop proposal, and reason list.

The stop boundary accepts only `DecimalString` values for Kijun, entry, and
tick. LONG uses a ceiling tick and SHORT a floor tick, then rechecks the rounded
price strictly against entry. No binary floating-point value determines an
executable stop.

## Testing strategy

Implementation follows red-green-refactor. Every public behavior starts with a failing test.

Required test groups:

1. Domain validation: OHLC invariants, positive prices, timestamps, decimal canonicalization.
2. Temporal alignment: unfinished H4 excluded, late H4 excluded until available, exact-boundary inclusion.
3. Ichimoku indexes: Tenkan at 8, Kijun and Senkou A at 25, Senkou B at 51, current cloud A at 51, current cloud B at 77.
4. Critical Kumo regression: a synthetic series where raw spans at `t` differ materially from spans at `t-26`; regime evaluation must use the latter.
5. Breakout: current candle excluded, equality rejected, insufficient history handled.
6. Strategy: bullish, bearish, neutral, and insufficient-data paths with structured reasons.
7. Initial stop: LONG stop strictly below entry reference and SHORT stop strictly above it.
8. Causality: calculating a decision from data truncated at `T` must equal the
   decision at `T` when later H1 and H4 candles are appended, including values
   outside the JavaScript `number` range and delayed H4 availability.

Coverage is a supporting signal, not the acceptance criterion. Acceptance requires all specified boundary and causality behaviors to pass under strict TypeScript compilation, linting, formatting checks, and tests.

## Build and quality gates

Root commands will provide:

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:coverage
pnpm build
pnpm check
```

`pnpm check` runs formatting validation, linting, typechecking, tests, and build. The milestone is complete only when the worktree is clean after a successful full check.

## Explicit exclusions

This milestone does not implement:

- risk sizing or the 1,000 EUR capital cap enforcement
- transaction costs, margin, FX, or exposure
- sequential backtesting or fill simulation
- H1-to-H4 resampling with real exchange sessions
- scoring thresholds or optimization
- persistence, APIs, dashboard, queues, or observability
- paper or live broker adapters

These exclusions prevent unresolved instrument and broker choices from leaking into the core causal strategy implementation. The next milestone begins with the independent Risk Engine, followed by the sequential backtester that reuses it.

## Completion criteria

The milestone is accepted when:

- the pnpm workspace installs reproducibly from its lockfile;
- all five packages compile independently and through the root project references;
- all public functions are covered by tests that were observed failing before implementation;
- the critical current-Kumo regression test passes;
- the causality test passes after appending future data;
- no application, persistence, broker, or live-execution code exists;
- `pnpm check` exits successfully with no errors.
