# Sequential Futures Backtester Design

Status: PR 2C.1 implemented; PR 2C.2 and PR 2C.3 remain planned

Date: 2026-08-14

## Purpose

Milestone 2C adds an in-memory, deterministic sequential portfolio backtester
for the causal Ichimoku futures research system. It composes the public APIs
already delivered by `@trading-auto/domain`, `@trading-auto/calendars`,
`@trading-auto/strategy-ichimoku`, `@trading-auto/risk`, and
`@trading-auto/execution`.

The backtester does not duplicate indicator, strategy, risk, or execution
formulas. It owns event ordering, portfolio state, accounting, orchestration,
run status, reproducibility, and metrics.

Milestone 2C is `RESEARCH_ONLY`. It does not place orders, contact a broker,
persist runs, provide a UI, or claim live execution quality.

## Approved scope decisions

- Delivery is split into three sequential pull requests that are reviewed and
  merged independently.
- The architecture is a pure event reducer over immutable state.
- Milestone 2C accepts only `HISTORICAL_RESEARCH` risk-policy use.
- `FORWARD` orchestration remains deferred to the paper engine.
- The first version is in memory and emits a JSON-compatible immutable artifact.
- The account currency is EUR and the baseline starts with exactly `1_000 EUR`.
- Cash injection after initialization is forbidden.
- One run uses one immutable approved `RiskPolicyVersion`.
- A higher sizing cap requires a separately approved policy version selected at
  run creation; it never changes automatically during a run.

## Non-goals

- H1 to H4 resampling;
- acquisition of exchange calendars, broker prices, margins, fees, or FX;
- parameter optimization, walk-forward scheduling, or bootstrap engines;
- database persistence, jobs, API routes, or dashboard screens;
- paper trading, broker submission, partial fills, order reconciliation, or
  live protective-stop acknowledgement;
- minute, tick, order-book, or market-impact simulation.

## Delivery slices

### PR 2C.1 — Clock, portfolio, and ledger

Create `@trading-auto/backtester` with:

- bounded immutable event contracts;
- deterministic event ordering;
- immutable run and portfolio state;
- a balanced append-only accounting ledger;
- exact cash, equity, margin, exposure, and open-risk invariants;
- the `NO_NEW_ENTRIES` operating state;
- hostile-runtime-input validation and stable typed errors.

This PR does not invoke the strategy or execution lifecycle. It establishes the
state machine and accounting kernel on which later slices depend.

### PR 2C.2 — End-to-end orchestration

Compose the public strategy, risk, calendar, and execution APIs for:

- causal H1 and H4 publication;
- signal decisions and entry intents;
- fresh risk evaluation at the executable open;
- entries, fixed stops, delayed trend exits, daily settlements, and rollovers;
- FDXS, MES, and mixed EUR/USD portfolios;
- lifecycle data failures represented as precise invalid-run results.

### PR 2C.3 — Result artifact and metrics

Add:

- the final immutable `BacktestResult`;
- the complete reproducibility manifest;
- daily equity and return series;
- deterministic trade, risk, exposure, cost, and performance metrics;
- milestone documentation and release verification.

## Package architecture

The package is divided by responsibility:

```text
packages/backtester/src/
  errors.ts       typed public-boundary errors
  event.ts        event contracts, validation, priority, semantic identity
  clock.ts        bounded deterministic queue
  ledger.ts       balanced journal entries and account totals
  portfolio.ts    immutable portfolio state and invariants
  reducer.ts      pure event-to-state transitions
  input.ts        run configuration and dataset boundary
  orchestrator.ts strategy/risk/execution composition
  result.ts       run status, manifest, warnings, artifact assembly
  metrics.ts      deterministic metric calculations
  index.ts        deliberately small public API
```

Each module has one clear purpose. Validation, state transitions, and metric
calculations remain in separate files. Internal decimal, cloning, and fixture
helpers are not exported.

The final public entry point is:

```ts
runSequentialBacktest(input: BacktestInput): Readonly<BacktestResult>
```

PR 2C.1 exports only the stable error, event, ledger, and portfolio contracts
that remain part of the final package API. Reducers, queue storage, mutable
classes, and arithmetic helpers remain internal.

## Runtime input

`BacktestInput` contains only explicit, versioned data:

- `backtestId`, `runCreatedAt`, `startAt`, and `endAt`;
- the approved risk policy used by the entire run;
- products and dated contracts;
- separately prepared H1 and H4 datasets;
- FX, margin, cost, and eligibility snapshot series;
- execution schedules, daily settlements, and roll schedules;
- strategy, indicator, execution, and exit-policy versions;
- a code commit or code hash and a canonical run-config hash.

The boundary requires:

```text
riskPolicyUseMode = HISTORICAL_RESEARCH
riskPolicyUseAt = runCreatedAt
backtestId is non-null and matches the run
approvedAt <= activatedAt <= runCreatedAt
```

The input is snapshotted from own enumerable descriptors exactly once before
business use. Sparse arrays, inherited required fields, revoked proxies,
throwing getters, symbols where strings are required, unsupported prototypes,
non-canonical decimals, non-canonical instants, and oversized collections are
rejected deterministically.

Initial safety limits are:

- at most 256 products;
- at most 256 dated contracts;
- at most 1,000,000 source items per stream;
- at most 1,000,000 queued events;
- at most 32 postings per ledger entry.

The implementation must check a collection limit before probing individual
indices or constructing arbitrary-precision decimals.

## Event model

Every event has:

- a stable semantic identifier;
- a canonical `availableAt` instant used by the clock;
- an event type with a fixed priority;
- explicit instrument, contract, and version provenance where applicable;
- a deeply immutable payload.

The semantic identifier is derived from logical identity, not from array
position. Duplicate identities with contradictory payloads invalidate the
dataset. Exact duplicates are rejected rather than silently deduplicated.

The clock sorts by:

1. canonical `availableAt`;
2. fixed event-type priority;
3. semantic identifier using bytewise ascending comparison.

It never uses incidental insertion order as a tie-breaker.

### Same-instant priority

At the same `availableAt`, the reducer applies:

1. `DATA_AVAILABLE` — publish causal schedules, snapshots, opens, closed bars,
   settlements, and roll data;
2. `CLOSED_BAR_POSITION` — process the completed H1 interval for existing
   positions, including conservative intrabar stops and trend-exit intents;
3. `DAILY_SETTLEMENT` — apply an observed official settlement to positions that
   remain open and reset their accounting basis;
4. `ROLL` — close a dated contract and conditionally re-enter the active target;
5. `OPEN_EXIT` — process gap stops and eligible pending trend exits;
6. `OPEN_ENTRY` — process eligible pending entry intents with a fresh risk check;
7. `SIGNAL_DECISION` — evaluate the newly available strategy decision;
8. `PORTFOLIO_SNAPSHOT` — record a due daily state;
9. `SESSION_END` — finalize the requested interval after every other event due
   at that instant.

The closed-bar position transition precedes settlement, rollover, and next-bar
open transitions at a shared H1 boundary because the completed interval is
economically earlier. This prevents a position stopped during the completed bar
from also receiving settlement or being processed at the following open, and it
ensures released risk is visible to later entries.

The execution package continues to enforce that a close-known signal or trend
exit cannot use an open whose economic time is equal to that close. Derived
fills are immediate outputs of the relevant open transition, not independently
reorderable queue items.

Appending an event whose `availableAt` is after the evaluated `endAt` must not
change any result inside the interval.

## Portfolio state

The immutable state records:

- `RUNNING` or `NO_NEW_ENTRIES` operating status;
- account currency;
- cash and realized equity;
- unrealized P&L, including asymmetric sizing treatment;
- used, reserved, and available margin;
- gross exposure, open risk, daily loss, and drawdown;
- active intents keyed by semantic identity;
- positions keyed by dated contract and position ID;
- exposure by risk group;
- active product-to-contract mapping;
- the append-only ledger;
- daily portfolio snapshots;
- processed-event count and last clock key.

The baseline initializes:

```text
accountCurrency = EUR
initialCash = 1000
realizedEquity = 1000
initialCapital = 1000
allowCashInjection = false
```

The selected policy's `maxSizingCapital` is fixed for the run. The baseline
policy uses `1_000 EUR`. Progressive sizing above that baseline is tested only
with a distinct, already approved policy whose fixed `maxSizingCapital` is
higher. No run changes policy or raises its cap automatically.

Sizing equity remains:

```text
max(0, realizedEquity + min(unrealizedPnl, 0))
```

and the risk engine applies the active policy cap. Unrealized gains never raise
sizing, while unrealized losses reduce it immediately.

When the minimum executable quantity cannot be funded, the state enters
`NO_NEW_ENTRIES`. Existing settlements, valuations, stops, exits, and rollovers
continue. The state returns to `RUNNING` only when a later causal portfolio
transition restores every entry prerequisite; it never injects cash.

## Accounting ledger

All postings use canonical decimals in the EUR account currency. A ledger entry
contains a stable entry ID, event ID, timestamp, description, and between two
and 32 postings.

Each entry must sum exactly to zero using a private, bounded `Decimal` clone.
The initial chart of accounts is:

- `CASH`;
- `CAPITAL`;
- `COSTS`;
- `PNL_CLEARING`;
- `FX_TRANSLATION`.

Examples:

```text
initialization:      CASH +1000 / CAPITAL -1000
execution cost:     CASH -x    / COSTS +x
domestic P&L:       CASH +x    / PNL_CLEARING -x
domestic loss:      CASH -x    / PNL_CLEARING +x
foreign P&L in EUR: CASH +x    / FX_TRANSLATION -x
```

`FX_TRANSLATION` is the balancing P&L account only when a foreign-currency
economic amount is converted into account currency; it is used instead of
`PNL_CLEARING`, not in addition to it. The originating versioned FX snapshot is
referenced by the ledger entry.

Reserved and used margin are portfolio constraints, not cash withdrawals. They
are recorded in state and event audit details but not posted as cash ledger
movements.

No public transition accepts a cash-deposit event after initialization.

## State invariants

After every event, the reducer checks:

- every ledger entry is exactly balanced;
- cash equals initial cash plus all `CASH` postings;
- realized equity reconciles to cash under the futures mark-to-market model;
- available funds reconcile to cash, margin, costs, and current valuation inputs;
- all positions and intents have unique semantic identities;
- no same-instrument pyramiding or simultaneous long/short hedge exists;
- position quantities, prices, costs, P&L, margin, and exposure are canonical;
- aggregate and risk-group totals equal the sum of their constituents;
- no state references data or snapshots unavailable at the current clock key;
- every lifecycle transition due at the current clock key has complete causal
  valuation, schedule, settlement, and roll coverage, and finalization confirms
  coverage through the evaluated boundary;
- `NO_NEW_ENTRIES` cannot suppress an existing-position lifecycle event;
- the risk policy and historical policy-use time never change during the run.

An invariant failure is a programmer or contradictory-input failure and never a
normal trading outcome.

## Orchestration pipeline

For each causal event, the backtester:

```text
publish data available at T
  -> transition existing positions due at T
  -> evaluate newly eligible Ichimoku decisions
  -> select causal risk snapshots
  -> evaluate order risk
  -> apply the execution transition
  -> append balanced ledger entries
  -> rebuild and verify portfolio aggregates
  -> emit audit records and due snapshots
```

Only the public contracts of upstream packages are called. The backtester does
not embed Ichimoku formulas, determine futures economics, invent a session, or
approximate a fill.

Candidate-time missing or stale FX, margin, or eligibility data remains a
stable risk rejection and the run continues. Missing FX needed to value an
existing foreign-currency position invalidates the run because the portfolio
cannot be reconciled.

## Result and error policy

The final immutable `BacktestResult` status is one of:

- `COMPLETED` — all required data and non-zero validated costs were present;
- `ANALYTICAL_ONLY` — the run explicitly used a complete zero-cost model;
- `INVALID_DATA` — required lifecycle coverage was missing or contradictory.

`NO_NEW_ENTRIES` is an internal operating status, not a final result status.

Expected business outcomes are returned and audited, including risk rejection,
quantity reduction, signal expiration, invalid stop at an opening gap, and
rollover re-entry refusal.

Missing lifecycle coverage becomes `INVALID_DATA` with:

- event ID and type;
- instrument and contract when applicable;
- canonical timestamp;
- field;
- expected version or coverage interval;
- stable reason code.

The orchestrator maps only explicitly classified lifecycle-data failures into
`INVALID_DATA`. It does not broadly catch exceptions. Malformed runtime values,
impossible state transitions, duplicate semantic identities, broken accounting
identities, and programmer-contract violations throw a typed
`BacktestInputError` or `BacktestStateError`.

No error path substitutes a price, close, FX rate, fee, margin, settlement,
schedule, roll, or quantity.

## Reproducibility manifest

Every result records:

```text
backtestId
datasetVersion
strategyVersion
indicatorConfigVersion
riskPolicyVersion
riskPolicyUseMode
riskPolicyUseAt
runCreatedAt
costModelVersion
marginModelVersion
fxDatasetVersion
sessionScheduleVersion
rollScheduleVersion
executionModelVersion
exitPolicyVersion
codeCommit or codeHash
runConfigHash
initialCapital
accountCurrency
```

`riskPolicyUseMode` is always `HISTORICAL_RESEARCH`, `backtestId` is non-null,
and `riskPolicyUseAt` equals `runCreatedAt` for every risk decision in the run.

The canonical result excludes wall-clock timestamps, object identities,
unordered map iteration, and environment-specific paths. Repeated runs with
equal inputs and versions must be deeply equal.

## Metrics

Metrics are computed only from the audited artifact:

- total return from initial and final realized equity;
- CAGR only when elapsed time and equity values make it mathematically defined;
- maximum drawdown from the daily equity curve;
- Sharpe from daily portfolio returns when at least two returns and non-zero
  sample deviation exist;
- Sortino from daily portfolio returns when downside deviation is defined and
  non-zero;
- profit factor when gross loss is non-zero;
- expectancy, average, and median R from trades with a defined initial risk;
- trade count, win rate, average winner, and average loser;
- exposure and holding time from dated position intervals;
- MAE and MFE from causal H1 bars inside each holding interval;
- turnover and costs as a share of gross P&L;
- feasible-signal rate;
- risk decisions grouped separately by status and stable reason.

Reduction reasons are never counted as rejections. Undefined metrics are
serialized as `null`, never `0`, `Infinity`, `-Infinity`, or `NaN`.

## Verification strategy

Implementation is strict TDD. Each behavior is first introduced by a focused
failing test, followed by the minimum implementation and fresh package and
repository gates.

Required coverage includes:

- deterministic same-instant ordering independent of input order;
- duplicate and contradictory event identities;
- exact ledger balance after every transition;
- no cash injection and exact `1_000 EUR` initialization;
- `NO_NEW_ENTRIES` while exits and settlements continue;
- FDXS-only, MES-only, and mixed EUR/USD runs;
- multiple risk groups without pyramiding or hedging;
- progressive sizing from realized gains under a separately approved higher
  fixed cap;
- no sizing increase from unrealized gains;
- immediate sizing reduction from unrealized losses;
- all signals rejected with zero trades;
- exact fills, fees, P&L, settlements, cash, equity, stops, exits, and rolls;
- missing required lifecycle inputs producing precise `INVALID_DATA` results;
- candidate-time stale snapshots producing risk rejection without run failure;
- `ANALYTICAL_ONLY` only for an explicitly complete zero-cost model;
- appending unavailable future events without changing the evaluated result;
- deeply equal repeated runs;
- immutable historical policy-use time and matching backtest IDs;
- Decimal global-configuration contamination without effect;
- forged casts, inherited fields, getters, proxies, sparse arrays, cycles, and
  input limits;
- explicit `null` for every statistically undefined metric.

Production code in `@trading-auto/backtester` must reach 100 percent statement,
branch, function, and line coverage. Repository format, lint, strict typecheck,
tests, build, diff checks, and production dependency audit must pass before each
PR is merged.

## Deferred after 2C

Persistence and API contracts are Phase 8. Dashboard and Strategy Lab are Phase
9. The paper engine is Phase 10, and the broker adapter is Phase 11. Those
phases reuse the public strategy, risk, and execution contracts without
weakening the `HISTORICAL_RESEARCH`-only boundary of this backtester.
