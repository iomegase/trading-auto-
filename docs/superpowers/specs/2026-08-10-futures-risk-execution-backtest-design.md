# Futures Risk, Execution, and Backtest Design

Date: 2026-08-10

Status: approved for implementation; Milestones 2A, 2B, and 2C remain planned

Delivery: three sequential milestones and three independent pull requests

## Purpose

Milestone 2 turns the causal Ichimoku research core into a deterministic futures
research pipeline. It sizes futures positions, simulates conservative H1-bar
execution, and runs a sequential portfolio backtest without adding a real broker,
paper broker, UI, database, or live execution.

The initial futures fixtures are:

- Micro-DAX futures (`FDXS`) with EUR P&L;
- Micro E-mini S&P 500 futures (`MES`) with USD P&L and EUR account conversion.

Both fixtures remain `RESEARCH_ONLY`. No result may be described as executable
until dated broker margin, cost, permission, and instrument data have been
validated separately.

## Approved decisions

The design incorporates the following decisions:

- use actual dated futures contracts for signals and execution;
- never execute a continuous futures symbol;
- use an immutable, versioned roll schedule;
- allow overnight and weekend positions across full exchange sessions, excluding
  declared maintenance breaks;
- remain broker-agnostic and accept versioned margin and cost snapshots;
- simulate entry at the next tradable H1 open;
- use H1 OHLC bars with a conservative `STOP_FIRST` ambiguity policy;
- require official or explicitly versioned daily settlement inputs;
- fail a run when a required settlement is absent;
- require non-zero, versioned costs for validated research results;
- permit zero-cost runs only as `ANALYTICAL_ONLY` diagnostics;
- roll an open position through an explicit exit and conditional re-entry;
- start with `1_000 EUR`, forbid cash injection, and compound only within an
  approved sizing-cap policy;
- deduct unrealized losses immediately but never use unrealized gains to enlarge
  a new position;
- use `0.50%` risk per trade, `2.00%` aggregate open risk, and at most four open
  positions;
- forbid pyramiding and simultaneous hedging on the same instrument.

## Capital-policy correction

The original V3 documents use `1_000 EUR` as a permanent hard capital cap. That
contract is superseded for Milestone 2 by two separate values:

```text
initialCapital = 1_000 EUR
maxSizingCapital = 1_000 EUR for the initial RiskPolicyVersion
```

For a decision at time `T`:

```text
asymmetricEquity(T) =
  realizedEquity(T) + min(0, unrealizedPnl(T))

sizingEquity(T) =
  min(max(0, asymmetricEquity(T)), maxSizingCapital)
```

Realized gains may enlarge positions only when the active, immutable
`RiskPolicyVersion` has a sufficiently high `maxSizingCapital`. Increasing the
cap is a manual control-plane decision that creates a new policy version. Broker
account balance, unrealized profit, strategy output, or a backtest result can
never raise it automatically.

Each backtest run uses one immutable risk-policy version. A cap increase requires
a new run for like-for-like research comparison. A future runtime may activate a
new version only from its approval instant forward; it may never rewrite history.

Losses reduce `sizingEquity` immediately. Cash injection remains forbidden in the
baseline backtest.

## Delivery sequence and gates

Implementation is strictly sequential:

```text
2A Futures Domain and Risk Engine
  -> verification, independent review, pull request, merge
2B Bar-Based Futures Execution
  -> verification, independent review, pull request, merge
2C Sequential Portfolio Backtester
  -> verification, independent review, pull request, merge
```

Milestone `2B` does not start before `2A` is merged. Milestone `2C` does not start
before `2B` is merged. Each milestone uses its own worktree and branch.

Every milestone requires:

- red-green-refactor evidence for every production behavior;
- deterministic unit and causality tests;
- formatting, lint, strict TypeScript typecheck, full tests, and build;
- exact-decimal boundary tests;
- an independent review with no unresolved Critical or Important finding;
- synchronized documentation before merge.

## Architecture

The existing packages remain the source of truth for candles, Ichimoku values,
strategy decisions, and causal H4 selection.

```text
@trading-auto/domain
  <- @trading-auto/calendars
  <- @trading-auto/indicators
  <- @trading-auto/strategy-ichimoku
  <- @trading-auto/risk
  <- @trading-auto/execution
  <- @trading-auto/backtester
```

The dependency arrows represent consumption of public contracts. The backtester
orchestrates packages; it does not reimplement indicator, strategy, risk, or
execution formulas.

`@trading-auto/test-helpers` supplies deterministic synthetic futures contracts,
sessions, roll schedules, snapshots, bars, and event streams. Production
packages never import it.

All executable prices, quantities, money, rates, costs, margin amounts, and P&L
use canonical decimal strings and isolated decimal arithmetic. JavaScript
`number` is not permitted across an executable-money boundary.

All economic instants are canonical UTC strings. Provider-local text is retained
only as source metadata.

## 2A — Futures domain and Risk Engine

### Responsibilities

Milestone `2A` adds `@trading-auto/risk` and the minimum shared domain contracts
required for futures sizing. It has no dependency on execution or backtesting.

The domain distinguishes a product from an expiring contract:

```text
FuturesProduct
  productCode
  exchange
  underlyingId
  quoteCurrency
  pnlCurrency
  monetaryValuePerPriceUnit
  tickSize
  tickValue
  quantityStep
  minQuantity
  riskGroup

FuturesContract
  contractId
  productCode
  expiry
  firstTradeAt
  lastTradeAt
  settlementType
```

For the baseline futures fixtures, `quantityStep` and `minQuantity` are whole
contracts. The model remains decimal-capable so future asset-class fixtures do
not require a breaking API change.

`monetaryValuePerPriceUnit` already contains the complete contract economics.
The engine validates `tickValue / tickSize` against it and never multiplies by a
contract multiplier a second time.

### Versioned runtime snapshots

Every external risk input is immutable and carries at least:

```text
version
source
observedAt
validFrom
validUntil
contractId or currencyPair
```

Snapshot types include:

- `FxSnapshot`;
- `MarginSnapshot`;
- `CostModelSnapshot`;
- `FuturesEligibilitySnapshot`;
- `RiskPolicy`.

An input must be observable and valid at `decisionAt`. Passing a future-observed,
internally inconsistent, or wrong-contract snapshot directly to the Risk Engine
is a typed input error. A present but stale FX, margin, or eligibility snapshot
produces a stable risk rejection. Cost coverage follows the stricter validated-run
policy below.

### Risk input and result

The public entry point is a pure sizing function conceptually equivalent to:

```text
evaluateOrderRisk(
  setup,
  accountState,
  portfolioState,
  futuresContract,
  fxSnapshot,
  marginSnapshot,
  costModelSnapshot,
  riskPolicy,
  decisionContext
) -> RiskDecision
```

`RiskDecision` is an immutable discriminated union:

- `APPROVE`, with the exact requested or calculated quantity;
- `REDUCE_SIZE`, when a previously requested quantity must be lowered;
- `REJECT`, when no tradable quantity satisfies every constraint.

Every result records stable reason codes, all input versions, `decisionAt`, the
entry and stop used, the per-contract risk, estimated costs, required margin,
gross notional exposure, aggregate open risk, and resulting portfolio limits.

### Sizing

The engine computes the largest quantity on the declared quantity grid that
satisfies all constraints simultaneously:

```text
worstCaseBudgetedLoss(quantity) <= sizingEquity * 0.50%
openRiskAfterOrder <= sizingEquity * 2.00%
marginAfterOrder <= allowedMargin
grossExposureAfterOrder <= allowedGrossExposure
availableFundsAfterOrder >= costs + cashReserve
openPositionsAfterOrder <= 4
```

`worstCaseBudgetedLoss` includes stop loss, adverse entry and exit slippage,
spread, commissions, exchange/clearing fees, and all declared fixed or tiered
costs. A bounded grid search is required when costs are nonlinear.

The risk policy must contain an explicit, versioned futures leverage or gross
exposure limit. There is no hidden default and margin compliance does not replace
notional-exposure measurement. Synthetic tests may declare scenario-specific
limits, but those limits do not claim real-world eligibility.

If one contract exceeds any risk, margin, cost, cash, or exposure constraint,
the result is `REJECT`. The engine never rounds a zero quantity up to one
contract.

Additional guards include stale FX, incoherent tick economics, invalid stop,
duplicate position or entry intent, risk-group limits, daily loss, drawdown,
kill switch, and signal expiry.

### 2A tests

Required test families include:

- FDXS EUR-native and MES USD-to-EUR conversions;
- exact tick economics without multiplier duplication;
- direct and inverse FX pairs with timestamp boundaries;
- stale, missing, future, and wrong-contract snapshots;
- nonlinear minimum commissions and round-trip costs;
- margin, available-funds, gross-exposure, and open-risk rejection;
- one-contract infeasibility without forced rounding;
- asymmetric equity under unrealized gain and loss;
- cap changes only through a new policy version;
- realized-profit compounding within the approved cap;
- immediate downsizing after loss;
- position, entry-intent, pyramiding, hedge, and risk-group guards;
- global decimal-configuration contamination;
- deterministic equality with future snapshots appended.

## 2B — Bar-based futures execution

### Responsibilities

Milestone `2B` adds `@trading-auto/execution`. It is a pure simulator, not a
broker adapter. It consumes approved strategy and risk results and produces an
immutable stream of order, fill, stop, exit, settlement, and rollover events.

The versioned baseline is:

```text
executionModelVersion = BAR_BASED_H1_V1
signalModel = SIGNAL_ON_CLOSE
entryFillModel = NEXT_BAR_OPEN
trendExitFillModel = NEXT_TRADABLE_PRICE
intrabarConflictPolicy = STOP_FIRST
partialFillPolicy = FULL_FILL_OR_REJECT
```

The lack of minute, tick, order-book, and partial-fill modeling is recorded in
every result. A bar-based result is not evidence of live fill quality.

### Entry lifecycle

```text
APPROVED strategy decision at H1 close
  -> immutable ENTRY OrderIntent
  -> wait for the next tradable H1 open
  -> refresh executable price and causal snapshots
  -> rerun the complete Risk Engine
  -> FILLED, REDUCED_AND_FILLED, or CANCELLED
```

The protective stop remains the exact, tick-aligned signal Kijun. The execution
layer does not use a future H1 indicator value to move it. If the next open makes
the stop invalid or the risk excessive, the entry is cancelled.

Only one active entry intent and one open position are allowed per instrument
and strategy version.

### Position event order

For an existing position, each H1 bar follows this order:

1. process an opening gap through the protective stop;
2. process pending fills eligible at the open;
3. evaluate the fixed protective stop intrabar;
4. apply a settlement or lifecycle event at its declared instant;
5. publish the H1 close;
6. evaluate the trend-exit rule on the closed candle;
7. create an exit intent for the next tradable price.

A close-known trend exit cannot erase a stop touched earlier in the bar.

If a bar opens beyond a stop, the fill uses the adverse available open plus the
versioned execution adjustment. It never uses the unreachable theoretical stop.

The baseline has no fixed take-profit, break-even rule, trailing stop, or
automatic parameter experiment.

### Sessions and schedules

`@trading-auto/calendars` is extended to consume immutable schedule artifacts:

- tradable UTC intervals;
- maintenance breaks;
- last trading instants;
- settlement instants;
- active-contract windows;
- rollover instants.

The engine does not infer exchange holidays or DST rules from weekday arithmetic.
The supplied schedule is the versioned source of truth. Missing schedule coverage
invalidates the simulation interval.

H1 and H4 remain separately supplied causal datasets. Automatic H1-to-H4
resampling is not added in this milestone.

### Settlement

An overnight futures position requires `DAILY_SETTLEMENT` events. Each event:

- applies variation margin to cash;
- resets the accounting settlement basis;
- preserves the economic trade-entry price for trade metrics;
- recalculates equity, available funds, and margin;
- may activate risk guards that block new entries.

A required settlement price may not be replaced silently by an H1 close. Missing
settlement data makes the run `INVALID_DATA`.

### Rollover

The simulator never changes a contract identifier in place. At a versioned roll
event, an open position follows:

```text
exit expiring contract at the permitted price
  -> record realized P&L, costs, and slippage
  -> load the next dated contract
  -> recompute the protective stop under the versioned roll policy
  -> rerun the Risk Engine
  -> conditionally open the new contract
```

Failure of the new contract's risk check leaves the portfolio flat. No entry
price, P&L, or cost is transferred synthetically between contracts.

Continuous futures series may be used for separate research diagnostics but are
never executable instruments and are not accepted by the execution API.

### 2B tests

Required tests include:

- no fill at the signal close;
- fill only at the next tradable H1 open;
- gap invalidating an entry;
- full fill, reduced fill, and cancelled fill after risk recheck;
- stop touched intrabar and stop crossed by an opening gap;
- `STOP_FIRST` under ambiguous OHLC paths;
- trend exit created at close and filled later;
- no take-profit, break-even, or trailing behavior;
- exact round-trip costs and slippage;
- missing and valid daily settlement;
- variation-margin accounting;
- schedule gaps, maintenance breaks, expiry boundaries, and DST-shaped UTC
  intervals supplied by fixtures;
- explicit rollover exit, conditional re-entry, and rejected re-entry;
- continuous-symbol rejection;
- future bars and snapshots having no effect on a decision at `T`.

## 2C — Sequential portfolio backtester

### Responsibilities

Milestone `2C` adds `@trading-auto/backtester`. It composes the existing strategy,
Risk Engine, execution simulator, and calendars under one deterministic event
clock. It does not duplicate their business logic.

The first version is in-memory and returns a serializable JSON-compatible
artifact. Persistence and UI are deferred.

### Event clock

The clock processes immutable events such as:

```text
CANDLE_AVAILABLE
SIGNAL_DECISION
NEXT_BAR_OPEN
FILL
STOP
TREND_EXIT
DAILY_SETTLEMENT
ROLL
SESSION_END
```

Events are ordered by canonical instant and a documented event-type priority,
never by incidental array insertion order. At time `T`, consumers can observe
only inputs with `availableAt <= T` and snapshots with `observedAt <= T`.

### Portfolio state

The state machine maintains:

- cash and realized equity;
- unrealized P&L and asymmetric sizing equity;
- variation margin;
- reserved and available margin;
- order intents and fills;
- positions by dated contract;
- risk-group exposure and aggregate open risk;
- active product-to-contract mapping;
- an append-only accounting ledger;
- daily portfolio snapshots.

Every mutation is derived from an event and emits an auditable ledger entry.
Accounting identities are checked after every event.

The baseline starts with `1_000 EUR`, the initial `maxSizingCapital` of
`1_000 EUR`, and no cash injection. If funds become insufficient, the run enters
`NO_NEW_ENTRIES` while still processing settlements, stops, exits, and portfolio
valuation.

### Pipeline

```text
market or lifecycle event
  -> publish only causally available data
  -> evaluate existing Ichimoku decision API
  -> evaluate Risk Engine
  -> apply execution simulator transition
  -> update ledger and portfolio
  -> emit decision and equity snapshots
```

The same public strategy and risk functions are intended for later paper/live
orchestration. No strategy formula is embedded in the backtester.

### Result artifact

`BacktestResult` is immutable and contains:

- `COMPLETED`, `ANALYTICAL_ONLY`, or `INVALID_DATA` status;
- full version manifest;
- input interval and event counts;
- strategy decisions and stable reason codes;
- risk approvals, reductions, and rejections;
- order intents, fills, settlements, exits, and rollovers;
- positions and ledger;
- daily equity and return series;
- data-quality and model-limit warnings;
- deterministic metrics.

Metrics include total return, maximum drawdown, daily Sharpe and Sortino when
statistically defined, profit factor, expectancy in R, trade count, win rate,
average and median R, average winner and loser, exposure, holding time, MAE, MFE,
turnover, costs as a share of gross P&L, feasible-signal rate, and risk rejection
counts by reason.

Sharpe and Sortino use the declared daily portfolio-return series, never raw
trade R-multiples. Undefined metrics remain explicitly `null`; the engine does
not invent zeroes.

### Reproducibility manifest

Every run records at least:

```text
datasetVersion
strategyVersion
indicatorConfigVersion
riskPolicyVersion
costModelVersion
marginModelVersion
fxDatasetVersion
sessionScheduleVersion
rollScheduleVersion
executionModelVersion
exitPolicyVersion
codeCommit or codeHash
runConfigHash
```

Equivalent inputs and versions must produce a deeply equal artifact. Appending
events unavailable at the evaluated end instant must not change the artifact for
that interval.

### 2C tests

Required tests include:

- total ledger debits equal credits under the chosen accounting representation;
- no implicit cash injection;
- exact reconciliation of fills, fees, P&L, settlements, cash, and equity;
- deterministic same-timestamp event ordering;
- `NO_NEW_ENTRIES` after insufficient capital while exits continue;
- runs with all signals rejected and zero trades;
- FDXS-only, MES-only, and mixed EUR/USD portfolios;
- multiple risk groups without same-instrument pyramiding or hedging;
- progressive sizing from realized gains within the active cap;
- no sizing increase from unrealized gains;
- immediate sizing reduction from unrealized losses;
- future-event append causality;
- deeply equal repeated runs;
- `INVALID_DATA` on missing settlements, schedules, required costs, contract
  coverage, or FX needed to value an existing position;
- stable risk rejection when candidate sizing lacks fresh FX, margin, or
  eligibility data;
- `ANALYTICAL_ONLY` on an explicitly zero-cost diagnostic run;
- metrics derived from daily portfolio returns and explicit nulls when undefined.

## Error policy

Expected business outcomes are returned, not thrown:

- no admissible quantity;
- insufficient margin or available funds;
- a present but stale or expired decision-time FX, margin, or eligibility
  snapshot;
- risk, exposure, position-count, group, daily-loss, or drawdown limit reached;
- signal expired;
- rollover re-entry rejected.

Malformed values, impossible state transitions, mismatched versions or contracts,
non-dense event inputs, broken accounting identities, and programmer-contract
violations throw typed errors during direct package use.

At the backtest boundary, absent lifecycle coverage, including a missing required
settlement, session interval, roll event, contract interval, or valuation input,
is captured in an `INVALID_DATA` result with the precise event, contract,
timestamp, field, and version. Malformed or contradictory datasets also make the
run invalid. Missing, stale, or expired cost coverage makes a validated run
invalid. An explicitly complete zero-cost model changes the run status to
`ANALYTICAL_ONLY`. FX missing for valuation of an existing foreign-currency
position is also invalid. By contrast, absent or stale candidate-time FX, margin,
or eligibility data produces a risk rejection for that prospective order and the
run continues. The engine never catches an error and substitutes a price, FX
rate, margin, settlement, cost, calendar, or quantity.

## Documentation changes required before implementation

The written implementation plans must update or supersede every authoritative V3
statement that still treats `1_000 EUR` as a permanent cap. The repository scan
identifies the following documents and contracts for synchronized amendments:

- `README.md`;
- `specs/00-README.md`;
- `specs/01-PRODUCT-SPEC.md`;
- `specs/02-FUNCTIONAL-SPEC.md`;
- `specs/04-DOMAIN-MODEL.md`;
- `specs/10-STOP-EXIT-SPEC.md`;
- `specs/11-RISK-ENGINE-SPEC.md`;
- `specs/12-BACKTEST-ENGINE-SPEC.md`;
- `specs/13-EXECUTION-BROKER-SPEC.md`;
- `specs/14-DATABASE-SCHEMA.md`;
- `specs/15-API-CONTRACTS.md`;
- `specs/16-UI-UX-SPEC.md`;
- `specs/17-TEST-PLAN.md`;
- `specs/18-OBSERVABILITY-SPEC.md`;
- `specs/19-SECURITY-SAFETY-SPEC.md`;
- `specs/20-VALIDATION-RESEARCH-SPEC.md`;
- `specs/21-IMPLEMENTATION-ROADMAP.md`;
- `specs/22-ACCEPTANCE-CRITERIA.md`;
- `specs/23-STRATEGY-CONFIG.example.json`;
- `specs/24-CODEX-PROMPT.md`;
- `specs/25-DECISIONS.md`;
- `specs/26-DEFINITION-OF-DONE.md`;
- `specs/30-AUDIT-CORRECTIONS-V3.md`;
- milestone documentation where the permanent-cap wording appears.

The amendments must preserve:

- `initialCapital = 1_000 EUR`;
- no cash injection;
- initial `maxSizingCapital = 1_000 EUR`;
- manual, versioned cap increases only;
- asymmetric unrealized-P&L treatment;
- risk and execution decisions bound to the active policy version;
- explicit notional exposure and leverage controls.

No implementation PR may leave authoritative specs contradicting its public
contracts.

## Explicitly deferred

Milestone 2 does not include:

- real broker credentials or adapters;
- real margin or commission ingestion;
- executable eligibility claims for FDXS or MES;
- continuous-contract execution;
- automatic roll inference from future volume or open interest;
- automatic H1-to-H4 resampling;
- minute, tick, order-book, queue-position, or partial-fill simulation;
- database persistence;
- web UI;
- automatic parameter or profit optimization;
- paper, semi-automatic, or live order submission;
- automatic increases to `maxSizingCapital`;
- guarantees of profitability or maximum loss.

## External product references

- Eurex Micro Product Suite: <https://www.eurex.com/micro/>
- CME Micro E-mini equity-index futures FAQ:
  <https://www.cmegroup.com/articles/faqs/frequently-asked-questions-micro-e-mini-equity-index-futures.html>

Exchange product facts are reference inputs, not broker margin or cost data.
