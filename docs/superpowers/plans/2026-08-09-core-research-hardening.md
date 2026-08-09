# Core Research Milestone Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the confirmed temporal look-ahead, series-integrity, H4-boundary, reproducibility, and executable-stop defects in the first milestone.

**Architecture:** Add canonical UTC/domain-series validation, attach complete provenance and exact Kijun values to versioned Ichimoku snapshots, select H4 candle/snapshot pairs through a strict temporal API, and expose one causal strategy orchestration API. Keep full exchange calendars, resampling, risk sizing, and execution outside this milestone.

**Tech Stack:** TypeScript 7 native compiler, pnpm workspace, Vitest 4, Temporal polyfill, decimal.js, Zod 4, ESLint, Prettier.

---

## File map

```text
packages/domain/src/time.ts                 canonical UTC instants
packages/domain/src/candle.ts               non-blank candle metadata
packages/domain/src/decision.ts             reproducibility context
packages/domain/src/series.ts               shared candle-series invariants
packages/indicators/src/ichimoku.ts          provenance, config version, exact Kijun
packages/calendars/src/h4-selection.ts       strict H4 candle/snapshot selection
packages/strategy-ichimoku/src/candidate.ts  H1 decision-time guards
packages/strategy-ichimoku/src/stop.ts       exact tick-aligned stop
packages/strategy-ichimoku/src/decision.ts   safe full-pipeline public API
packages/strategy-ichimoku/src/causality.test.ts real H1/H4 causal regression
```

### Task 1: Canonical time, metadata, and series contracts

**Files:**
- Modify: `packages/domain/src/time.ts`
- Modify: `packages/domain/src/candle.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/src/decision.ts`
- Create: `packages/domain/src/series.ts`
- Modify: `packages/domain/src/candle.test.ts`
- Create: `packages/domain/src/series.test.ts`

- [ ] **Step 1: Write failing UTC and metadata tests**

Add assertions that an offset instant is returned as canonical UTC and that
whitespace-only `instrumentId`, `sourceTimestamp`, `sourceTimezone`,
`exchangeTimezone`, and `provider` values throw `DomainValidationError`.

```ts
expect(asInstantString('2026-01-01T10:00:00+02:00')).toBe(
  '2026-01-01T08:00:00Z',
);
expect(() => createCandle({ ...validInput, instrumentId: '   ' })).toThrow(
  DomainValidationError,
);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test packages/domain/src/candle.test.ts`

Expected: offset normalization and blank-metadata cases fail for the current
implementation.

- [ ] **Step 3: Implement canonical time and non-blank validation**

Return `Temporal.Instant.from(value).toString()` from `asInstantString` and use
`value.trim().length === 0` in the candle metadata guard while preserving valid
input text.

- [ ] **Step 4: Write failing series-integrity tests**

Define and test:

```ts
export interface CandleSeriesExpectation {
  readonly instrumentId?: string;
  readonly timeframe?: Timeframe;
}

export function assertCandleSeries(
  candles: readonly Candle[],
  expectation?: Readonly<CandleSeriesExpectation>,
): void;
```

Tests must reject a sparse array, mixed instruments, mixed timeframes,
non-increasing `closeTime`, and overlap where
`current.openTime < previous.closeTime`. Empty and valid gapped series pass.

- [ ] **Step 5: Verify series RED, implement, and verify GREEN**

Run: `pnpm test packages/domain/src/series.test.ts`

Use `Temporal.Instant.compare` for economic ordering and throw `RangeError`
with the offending index/invariant. Export `DecisionContext`,
`CandleSeriesExpectation`, and `assertCandleSeries` from the domain barrel.

```ts
export interface DecisionContext {
  readonly decisionAt: InstantString;
  readonly signalCandleCloseTime: InstantString;
  readonly trendCandleCloseTime: InstantString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
}
```

- [ ] **Step 6: Run Task 1 gate and commit**

Run: `pnpm test packages/domain && pnpm typecheck && pnpm lint`

Commit: `fix(domain): enforce causal time and series contracts`

### Task 2: Versioned Ichimoku provenance and exact Kijun

**Files:**
- Modify: `packages/indicators/package.json`
- Modify: `packages/indicators/src/ichimoku.ts`
- Modify: `packages/indicators/src/ichimoku.test.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing config/provenance tests**

Make `IchimokuConfig.version` required. Add tests for blank/missing versions and
assert every point contains:

```ts
{
  instrumentId: candle.instrumentId,
  timeframe: candle.timeframe,
  candleCloseTime: candle.closeTime,
  configVersion: config.version,
}
```

Add RED tests showing sparse, unordered, overlapping, mixed-instrument, and
mixed-timeframe inputs are currently accepted or fail unclearly.

- [ ] **Step 2: Write failing availability and exact-Kijun tests**

Create an older candle whose `availableAt` is later than the current candle's
availability and assert the current point's `computedAt` equals the maximum
prefix availability. Use high `0.2`, low `0.1` and assert
`kijunPrice === '0.15'` while `kijun` remains a number.

- [ ] **Step 3: Verify RED**

Run: `pnpm test packages/indicators/src/ichimoku.test.ts`

Expected: failures for missing fields, unvalidated series, prefix availability,
and missing exact Kijun.

- [ ] **Step 4: Implement parsed config and provenance**

Move `zod` from the domain package to indicators and parse the config with a
schema whose numeric fields are positive safe integers and whose `version` is a
trimmed non-blank string. Convert schema failures to a clear `RangeError` so the
existing programmer-error contract remains stable.

Extend `IchimokuPoint` with:

```ts
readonly instrumentId: string;
readonly timeframe: Timeframe;
readonly candleCloseTime: InstantString;
readonly configVersion: string;
readonly kijunPrice: DecimalString | null;
```

Call `assertCandleSeries` before mapping. Track the maximum prefix
`availableAt` with `Temporal.Instant.compare`. Compute exact Kijun window
midpoints with a module-private stable `Decimal.clone` and
`lower.plus(upper.minus(lower).div(2)).toFixed()`.

- [ ] **Step 5: Update every config fixture and verify GREEN**

Add explicit versions such as `baseline-9-26-52-v1` to all indicator and
strategy test configs. Update hand-built points with their provenance and exact
Kijun field.

Run:

```bash
pnpm install --lockfile-only
pnpm test packages/indicators packages/strategy-ichimoku
pnpm typecheck
```

- [ ] **Step 6: Commit Task 2**

Commit: `fix(indicators): bind causal provenance and exact Kijun`

### Task 3: Strict H4 candle/snapshot selection

**Files:**
- Modify: `packages/calendars/package.json`
- Create: `packages/calendars/src/h4-selection.ts`
- Create: `packages/calendars/src/h4-selection.test.ts`
- Modify: `packages/calendars/src/index.ts`
- Modify: `packages/calendars/tsconfig.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing strict-selection tests**

Use the wished-for API:

```ts
selectLatestAvailableH4Snapshot(
  candles,
  points,
  asInstantString('2026-01-04T10:00:00Z'),
  'TEST',
)
```

Assert `SELECTED` for the latest closed H4 candle whose candle and snapshot are
available. Assert `NO_CLOSED_TREND_CANDLE` for none/unfinished/late candles and
`INSUFFICIENT_DATA` when the latest eligible candle has a future or incomplete
snapshot. Reject wrong timeframe, instrument, array-length mismatch, and
snapshot provenance mismatch.

- [ ] **Step 2: Verify RED**

Run: `pnpm test packages/calendars/src/h4-selection.test.ts`

Expected: module/API missing.

- [ ] **Step 3: Implement the selection union**

```ts
export type H4SelectionResult =
  | {
      readonly status: 'SELECTED';
      readonly candle: Candle;
      readonly point: IchimokuPoint;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly reason: 'NO_CLOSED_TREND_CANDLE' | 'INSUFFICIENT_DATA';
    };
```

Validate one-to-one provenance, use actual instant comparison, choose the
greatest eligible close, and freeze result objects. Add indicators as a
production workspace dependency and project reference.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm test packages/calendars && pnpm typecheck && pnpm lint`

Commit: `feat(calendars): select causal H4 snapshots`

### Task 4: Harden candidate/regime and implement exact tick stop

**Files:**
- Modify: `packages/strategy-ichimoku/src/breakout.ts`
- Modify: `packages/strategy-ichimoku/src/breakout.test.ts`
- Modify: `packages/strategy-ichimoku/src/regime.ts`
- Modify: `packages/strategy-ichimoku/src/regime.test.ts`
- Modify: `packages/strategy-ichimoku/src/candidate.ts`
- Modify: `packages/strategy-ichimoku/src/candidate.test.ts`
- Modify: `packages/strategy-ichimoku/src/stop.ts`
- Modify: `packages/strategy-ichimoku/src/stop.test.ts`

- [ ] **Step 1: Write failing breakout/regime integrity tests**

Assert breakout rejects mixed/unordered/overlapping series. Assert regime
rejects a non-H4 candle, invalid runtime cloud direction, and point provenance
that does not match the candle.

- [ ] **Step 2: Write failing candidate causality/version tests**

Add `datasetVersion` to candidate inputs. Assert rejection by exception for an
unfinished signal candle, `availableAt > decisionAt`, `closeTime > decisionAt`,
future or mismatched indicator provenance, future trend close, unavailable
breakout constituent, wrong timeframe, and blank dataset version. Assert the
successful immutable result contains `datasetVersion` and
`indicatorConfigVersion`.

- [ ] **Step 3: Write failing exact-stop tests**

Update tests to call:

```ts
proposeKijunStop(
  'LONG',
  asDecimalString('0.15'),
  asDecimalString('1'),
  asDecimalString('0.01'),
)
```

Cover exact values, LONG ceiling and SHORT floor, already aligned values,
non-positive/invalid Kijun, non-positive entry/tick programmer errors, and
post-rounding invalidation.

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm test packages/strategy-ichimoku/src/breakout.test.ts \
  packages/strategy-ichimoku/src/regime.test.ts \
  packages/strategy-ichimoku/src/candidate.test.ts \
  packages/strategy-ichimoku/src/stop.test.ts
```

- [ ] **Step 5: Implement the minimal guards and exact stop**

Reuse `assertCandleSeries`. Compare canonical instant strings through Temporal
or `Temporal.Instant.compare`. Validate point provenance before using numeric
fields. Add `datasetVersion` and `indicatorConfigVersion` to the result.

The stop uses only `DecimalString`, divides by a positive tick, applies
`ceil()` for LONG and `floor()` for SHORT, multiplies by the tick, serializes
with `toFixed()`, and rechecks the rounded price strictly against entry.

- [ ] **Step 6: Verify GREEN and commit**

Run: `pnpm test packages/strategy-ichimoku && pnpm typecheck && pnpm lint`

Commit: `fix(strategy): enforce causal decisions and exact stops`

### Task 5: Expose the safe decision pipeline and repair causality proof

**Files:**
- Create: `packages/strategy-ichimoku/src/decision.ts`
- Create: `packages/strategy-ichimoku/src/decision.test.ts`
- Modify: `packages/strategy-ichimoku/src/index.ts`
- Modify: `packages/strategy-ichimoku/src/causality.test.ts`
- Modify: `packages/strategy-ichimoku/package.json`
- Modify: `packages/strategy-ichimoku/tsconfig.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing orchestration tests**

Define `evaluateIchimokuDecision` with the input and result union from the
approved hardening design. Assert it propagates
`NO_CLOSED_TREND_CANDLE`/`INSUFFICIENT_DATA`, binds H4 regime to the selected
candle, returns full versions/context, rejects invalid stop approval, and is the
only public approval path.

- [ ] **Step 2: Verify RED and implement orchestration**

Run: `pnpm test packages/strategy-ichimoku/src/decision.test.ts`

Compute H1/H4 points, call strict H4 selection, regime, internal candidate, and
exact stop in order. Freeze every result and reason list. Remove the raw
candidate evaluator from the public barrel and export the safe API/result
types.

- [ ] **Step 3: Replace the causal integration fixture**

Build at least 100 genuine H1 candles and 90 genuine H4 candles on distinct
grids. Put the H1 decision inside the next unfinished H4 window. Run
`evaluateIchimokuDecision` on the prefix and again with a large future shock
appended. Deep-compare the entire result and separately assert the selected H4
close precedes the decision.

- [ ] **Step 4: Verify integration and commit**

Run:

```bash
pnpm test packages/strategy-ichimoku/src/decision.test.ts
pnpm test packages/strategy-ichimoku/src/causality.test.ts
pnpm test packages/indicators/src/ichimoku.test.ts \
  -t "aligns current-cloud values with raw spans computed displacement candles ago"
```

Commit: `feat(strategy): expose causal Ichimoku decision pipeline`

### Task 6: Documentation and final audit gate

**Files:**
- Modify: `README.md`
- Modify: `docs/milestones/core-research.md`
- Modify: `docs/superpowers/specs/2026-08-09-core-research-milestone-design.md`

- [ ] **Step 1: Correct documentation**

Document Node.js `>=22.15`, the safe decision API, UTC normalization, versioned
config/dataset context, exact tick stop, and explicit session-calendar/resample
exclusion. Update the original dependency policy to reflect Zod's actual config
boundary use.

- [ ] **Step 2: Run reproducibility and quality gates**

```bash
pnpm install --frozen-lockfile
pnpm format
git diff --check
pnpm check
pnpm test:coverage
pnpm audit --prod
```

Expected: all commands exit zero; no warnings, failures, or lockfile changes.

- [ ] **Step 3: Review scope and public API**

Verify no production UI, persistence, broker, risk, backtest, or live code was
introduced. Inspect package exports and declaration output to ensure raw
candidate approval is not public.

- [ ] **Step 4: Request whole-diff code review and correct findings**

Review from `2565f8160d6f8d0bfa371e0851432a00fa1ff384` through the hardening head.
Fix every Critical or Important issue with a fresh RED/GREEN cycle.

- [ ] **Step 5: Commit final documentation**

Commit: `docs: record causal hardening audit`
