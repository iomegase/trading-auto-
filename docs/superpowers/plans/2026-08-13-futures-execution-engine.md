# Futures Execution Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 2B as a pure, causal, exact-decimal H1 futures execution simulator with next-tradable-open entries, fixed protective stops, settlements, and explicit rolls.

**Architecture:** Add `@trading-auto/execution` after `@trading-auto/risk`. Keep validation, schedules, entry processing, position-bar processing, settlement accounting, and rollover in focused modules. Every public boundary snapshots untrusted inputs, returns deeply immutable events, uses canonical UTC/decimal strings, and delegates sizing to `evaluateOrderRisk` instead of duplicating risk formulas.

**Tech Stack:** TypeScript 7 native CLI with TypeScript 6 ESLint compatibility, pnpm workspaces, Vitest 4, `@js-temporal/polyfill`, `decimal.js`, existing domain/risk packages.

---

## File map

- `packages/execution/src/errors.ts`: stable execution input/data error taxonomy.
- `packages/execution/src/model.ts`: immutable fixed `BAR_BASED_H1_V1` model.
- `packages/execution/src/bar-events.ts`: separate open-price and closed-OHLC event boundaries.
- `packages/execution/src/schedule.ts`: versioned tradable intervals and causal open selection.
- `packages/execution/src/entry.ts`: entry intents and risk-rechecked next-open fills.
- `packages/execution/src/position.ts`: immutable open-position representation and H1 stop/trend-exit processing.
- `packages/execution/src/settlement.ts`: official settlement validation and variation-margin events.
- `packages/execution/src/rollover.ts`: explicit exit and conditional re-entry across dated contracts.
- `packages/execution/src/decimal.ts`: private isolated exact-decimal arithmetic.
- `packages/execution/src/index.ts`: intentionally small public ESM surface.
- `packages/execution/test-helpers/builders.ts`: deterministic tests only; never imported by production.
- `packages/test-helpers/src/execution.ts`: shared synthetic schedule/bar fixtures.

### Task 1: Scaffold `@trading-auto/execution`

**Files:**
- Create: `packages/execution/package.json`
- Create: `packages/execution/tsconfig.json`
- Create: `packages/execution/src/index.ts`
- Create: `packages/execution/src/errors.test.ts`
- Create: `packages/execution/src/errors.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.test.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing public-boundary test**

```ts
import { describe, expect, it } from 'vitest';
import { ExecutionInputError } from './index.js';

describe('ExecutionInputError', () => {
  it('copies and freezes stable error details', () => {
    const details = { field: 'bar', nested: { value: 'before' } };
    const error = new ExecutionInputError('INVALID_EXECUTION_INPUT', 'bad', details);
    details.nested.value = 'after';
    expect(error).toMatchObject({
      name: 'ExecutionInputError',
      code: 'INVALID_EXECUTION_INPUT',
      details: { field: 'bar', nested: { value: 'before' } },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm test packages/execution/src/errors.test.ts`

Expected: FAIL because the execution package/export does not exist.

- [ ] **Step 3: Add the workspace package and minimal stable error**

```ts
export type ExecutionInputErrorCode =
  | 'INVALID_EXECUTION_INPUT'
  | 'INVALID_EXECUTION_SCHEDULE'
  | 'INVALID_EXECUTION_STATE'
  | 'INVALID_DATA';

export class ExecutionInputError extends Error {
  readonly code: ExecutionInputErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
}
```

The implementation must bounded-clone cyclic/hostile details using the same safety principles as `RiskInputError`; it must not retain caller objects.

- [ ] **Step 4: Add TypeScript/Vitest aliases and project references**

Add `@trading-auto/execution` to root build references, test paths, and Vitest aliases. Package runtime dependencies are exact versions of `@js-temporal/polyfill`, `decimal.js`, `@trading-auto/domain`, and `@trading-auto/risk`.

- [ ] **Step 5: Run GREEN and gates**

Run: `pnpm test packages/execution/src/errors.test.ts && pnpm typecheck && pnpm lint`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/execution tsconfig.json tsconfig.test.json vitest.config.ts pnpm-lock.yaml
git commit -m "build: scaffold futures execution package"
```

### Task 2: Fixed model and versioned tradable schedule

**Files:**
- Create: `packages/execution/src/model.test.ts`
- Create: `packages/execution/src/model.ts`
- Create: `packages/execution/src/bar-events.test.ts`
- Create: `packages/execution/src/bar-events.ts`
- Create: `packages/execution/src/schedule.test.ts`
- Create: `packages/execution/src/schedule.ts`
- Create: `packages/execution/src/decimal.ts`
- Modify: `packages/execution/src/index.ts`
- Create: `packages/test-helpers/src/execution.ts`
- Modify: `packages/test-helpers/src/index.ts`

- [ ] **Step 1: Write RED tests for the exact model**

```ts
expect(createExecutionModel({
  version: 'BAR_BASED_H1_V1',
  signalModel: 'SIGNAL_ON_CLOSE',
  entryFillModel: 'NEXT_BAR_OPEN',
  trendExitFillModel: 'NEXT_TRADABLE_PRICE',
  intrabarConflictPolicy: 'STOP_FIRST',
  partialFillPolicy: 'FULL_FILL_OR_REJECT',
})).toEqual(expectedModel);
```

Each alternate/missing value, inherited field, hostile Proxy, blank version, or extra unsupported mode throws `INVALID_EXECUTION_INPUT`. The result is deeply frozen.

- [ ] **Step 2: Run model RED, implement minimum model factory, run GREEN**

Run: `pnpm test packages/execution/src/model.test.ts`

Expected RED: `createExecutionModel is not a function`; expected GREEN: all model cases pass.

- [ ] **Step 3: Write RED schedule tests**

First define two distinct market-data boundaries:

```ts
interface H1OpenEventInput {
  instrumentId: string;
  contractId: string;
  openTime: string;
  availableAt: string;
  price: string;
}

interface H1ClosedBarEventInput {
  instrumentId: string;
  contractId: string;
  openTime: string;
  closeTime: string;
  availableAt: string;
  open: string;
  high: string;
  low: string;
  close: string;
}
```

`H1OpenEvent` contains no high, low, or close field. Entry selection therefore
cannot inspect the future path of its own H1 bar. `H1ClosedBarEvent` requires
`availableAt >= closeTime` and is used only after close for intrabar stop and
trend-exit processing.

- [ ] **Step 4: Run bar-event RED, implement factories, run GREEN**

Run: `pnpm test packages/execution/src/bar-events.test.ts`

Test canonical UTC, exact bounded OHLC values, `high >= open/close`,
`low <= open/close`, contract/instrument identity, one-read hostile inputs, and
deep freeze.

- [ ] **Step 5: Write RED schedule tests**

Define:

```ts
interface ExecutionScheduleInput {
  version: string;
  source: string;
  observedAt: string;
  validFrom: string;
  validUntil: string;
  contractId: string;
  tradableIntervals: readonly { start: string; end: string }[];
  maintenanceBreaks: readonly { start: string; end: string }[];
}
```

Test canonical UTC normalization, non-overlap, half-open intervals, maintenance exclusion, maximum 10,000 intervals, dense arrays, one-read descriptors, and rejection when the schedule is not observable at `decisionAt`.

- [ ] **Step 6: Specify and test the selector**

```ts
selectNextTradableH1Open({
  signalCloseTime,
  decisionAt,
  contract,
  schedule,
  openEvents,
})
```

It returns the earliest `H1OpenEvent` whose `openTime > signalCloseTime`, whose open is inside a tradable interval and outside maintenance, whose `availableAt <= decisionAt`, and whose contract is active at the open. Same-close fills and continuous symbols are rejected. A regression test supplies throwing `high`, `low`, and `close` accessors on the source object and proves the selector never reads them.

- [ ] **Step 7: Run RED, implement schedule selection, run GREEN**

Run: `pnpm test packages/execution/src/schedule.test.ts`

Expected: schedule tests pass, including DST-shaped UTC fixtures and missing-coverage `INVALID_DATA`.

- [ ] **Step 8: Commit**

```bash
git add packages/execution/src packages/test-helpers/src
git commit -m "feat(execution): select causal tradable opens"
```

### Task 3: Entry intent and next-open risk recheck

**Files:**
- Create: `packages/execution/src/entry.test.ts`
- Create: `packages/execution/src/entry.ts`
- Create: `packages/execution/test-helpers/builders.ts`
- Modify: `packages/execution/src/index.ts`

- [ ] **Step 1: Write RED tests for immutable entry intent creation**

```ts
const intent = createEntryIntent({
  intentId: 'ENTRY-1',
  instrumentId: 'FDXS',
  strategyVersion: 'ICHIMOKU_V1',
  direction: 'LONG',
  signalCloseTime: '2026-01-02T09:00:00Z',
  expiresAt: '2026-01-02T12:00:00Z',
  stopPrice: '99',
  requestedQuantity: '2',
  riskDecisionId: 'RISK-AT-SIGNAL-1',
});
```

Reject non-approved provenance, invalid chronology, noncanonical decimals, zero quantity, duplicate/blank IDs, inherited fields, unsupported timeframe, and continuous instrument identifiers.

- [ ] **Step 2: Run intent RED, implement, run GREEN**

Run: `pnpm test packages/execution/src/entry.test.ts`

- [ ] **Step 3: Add RED cases for risk-rechecked fill outcomes**

Define `executeEntryAtNextOpen` to accept the selected bar, exact execution adjustment, and a complete fresh `OrderRiskInput` template. The function overwrites `entryPrice`, `stopPrice`, `requestedQuantity`, and `decisionAt` from trusted intent/open data before calling `evaluateOrderRisk`.

Expected events:

```text
APPROVE     -> ENTRY_FILLED
REDUCE_SIZE -> ENTRY_REDUCED_AND_FILLED
REJECT      -> ENTRY_CANCELLED
expired     -> ENTRY_CANCELLED / SIGNAL_EXPIRED
invalid stop after gap -> ENTRY_CANCELLED / INVALID_STOP_AT_OPEN
```

- [ ] **Step 4: Prove exact adverse entry adjustment**

LONG fill is `open + adverseEntrySlippagePriceUnits`; SHORT fill is `open - adverseEntrySlippagePriceUnits`. The result must remain positive, canonical, and tick aligned before risk evaluation.

- [ ] **Step 5: Run RED, implement minimal integration, run GREEN**

Run: `pnpm test packages/execution/src/entry.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/execution/src packages/execution/test-helpers
git commit -m "feat(execution): recheck entries at next open"
```

### Task 4: Protective stop and trend-exit lifecycle

**Files:**
- Create: `packages/execution/src/position.test.ts`
- Create: `packages/execution/src/position.ts`
- Modify: `packages/execution/src/index.ts`
- Modify: `packages/execution/test-helpers/builders.ts`

- [ ] **Step 1: Write RED tests for open-position construction**

An open position records fill, fixed stop, exact quantity, contract, direction, entry cost, signal close, fill instant, execution model version, dataset/strategy/risk versions, and limitations (`NO_INTRABAR_PATH`, `NO_PARTIAL_FILLS`, `NO_ORDER_BOOK`). Reject any mismatched fill/event/context.

- [ ] **Step 2: Run RED, implement immutable position factory, run GREEN**

- [ ] **Step 3: Write RED tests for H1 bar ordering**

For LONG:

```text
open <= stop -> STOP_GAP_EXIT at adverse open adjustment
low <= stop  -> PROTECTIVE_STOP_EXIT at adverse stop adjustment
otherwise    -> position remains open
```

SHORT is symmetric. The fixed stop never trails or moves to break-even.

- [ ] **Step 4: Add ambiguous-bar STOP_FIRST tests**

When a stop and a close-known trend exit are both possible in the same H1 bar, return only the stop exit. Future bars appended to the array must not alter the event at `T`.

- [ ] **Step 5: Add close-known trend-exit intent tests**

LONG `close < current closed-bar Kijun` and SHORT inverse create an immutable
`TREND_EXIT_INTENT` at candle close. The current Kijun must be computed and
available no earlier than that close; it never replaces or moves the protective
stop, which remains the fixed signal-time Kijun. The intent fills only at a later
tradable open using `NEXT_TRADABLE_PRICE`.

- [ ] **Step 6: Run full position GREEN and commit**

Run: `pnpm test packages/execution/src/position.test.ts`

```bash
git add packages/execution/src packages/execution/test-helpers
git commit -m "feat(execution): process fixed stops and trend exits"
```

### Task 5: Daily settlement and variation margin

**Files:**
- Create: `packages/execution/src/settlement.test.ts`
- Create: `packages/execution/src/settlement.ts`
- Modify: `packages/execution/src/index.ts`

- [ ] **Step 1: Write RED settlement factory tests**

Define `DailySettlementInput` with version/source/observedAt/effectiveAt/contractId/currency/price. Require causal observability, exact currency/contract matching, tick alignment, bounded decimals, and one settlement per effective instant.

- [ ] **Step 2: Run RED, implement factory, run GREEN**

- [ ] **Step 3: Write RED variation-margin tests**

For quantity `q`, monetary value `v`, old basis `b`, settlement `s`:

```text
LONG variation = (s - b) * v * q
SHORT variation = (b - s) * v * q
```

The event updates cash/realized equity, resets only the accounting basis to `s`, preserves economic entry price, and never mutates the position.

- [ ] **Step 4: Prove missing required settlement is INVALID_DATA**

No H1 close fallback is allowed. A future settlement cannot satisfy an earlier required instant.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm test packages/execution/src/settlement.test.ts
git add packages/execution/src
git commit -m "feat(execution): apply futures variation margin"
```

### Task 6: Explicit contract rollover

**Files:**
- Create: `packages/execution/src/rollover.test.ts`
- Create: `packages/execution/src/rollover.ts`
- Modify: `packages/execution/src/index.ts`
- Modify: `packages/test-helpers/src/execution.ts`

- [ ] **Step 1: Write RED roll-schedule validation tests**

Define immutable `RollSchedule` entries with `fromContractId`, `toContractId`, `rollAt`, `observedAt`, and version/source. Reject inferred rolls, same-contract rolls, overlap, noncausal observation, gaps in contract metadata, and roll instants outside active windows.

- [ ] **Step 2: Run RED, implement validation, run GREEN**

- [ ] **Step 3: Write RED explicit-exit tests**

At `rollAt`, close the old contract at the permitted causal price, apply exit costs/slippage, emit realized P&L, and leave no mutated contract identifier.

- [ ] **Step 4: Write RED conditional-re-entry tests**

Re-entry requires a newly supplied stop for the new contract, current snapshots, and a complete `evaluateOrderRisk` call. APPROVE/REDUCE creates a new distinct position; REJECT leaves the result flat with the exact risk reasons.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm test packages/execution/src/rollover.test.ts
git add packages/execution/src packages/test-helpers/src
git commit -m "feat(execution): roll dated futures explicitly"
```

### Task 7: Cross-module causal acceptance tests

**Files:**
- Create: `packages/execution/src/causality.test.ts`
- Create: `packages/execution/src/acceptance.test.ts`
- Modify: `packages/execution/test-helpers/builders.ts`

- [ ] **Step 1: Write future-append invariance RED tests**

Run the same entry/position/settlement decision twice: once with the causal prefix and once with later bars, schedules, settlements, and snapshots appended. Deep equality of the complete emitted events is required.

- [ ] **Step 2: Write FDXS/MES exact acceptance RED tests**

FDXS exercises EUR economics and maintenance gaps. MES exercises USD P&L with causal EUR conversion. Both must prove next-open fill, stop gap-through, exact costs, and no continuous-symbol execution.

- [ ] **Step 3: Add hostile-boundary matrix**

Every public factory/function rejects revoked Proxies, inherited required fields, sparse arrays, oversized collections, noncanonical instants/decimals, ambient `Decimal.set` contamination, and mutation attempts with `ExecutionInputError` rather than native exceptions.

- [ ] **Step 4: Run focused and global coverage**

Run:

```bash
pnpm test packages/execution
pnpm test:coverage
```

Expected: all execution business modules at 100% statements/branches/functions/lines; global suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/execution
git commit -m "test(execution): prove causal futures fills"
```

### Task 8: Documentation, public boundary, and release gates

**Files:**
- Create: `docs/milestones/futures-execution.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-10-futures-risk-execution-backtest-design.md`
- Modify: `specs/17-TEST-PLAN.md`
- Modify: `specs/21-IMPLEMENTATION-ROADMAP.md`
- Modify: `specs/22-ACCEPTANCE-CRITERIA.md`
- Modify: `specs/26-DEFINITION-OF-DONE.md`

- [ ] **Step 1: Document delivered and deferred boundaries**

Mark 2B implemented and keep sequential portfolio clock, run orchestration, statistics, persistence, API, UI, paper broker, and live broker in 2C or later. State `RESEARCH_ONLY` and the lack of tick/order-book/partial-fill evidence.

- [ ] **Step 2: Verify public exports**

Build and inspect `packages/execution/dist/index.d.ts` and `index.js`. Only stable 2B factories/types are exported; private Decimal helpers and test builders are absent.

- [ ] **Step 3: Run final gates**

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm test:coverage
pnpm audit --prod
git diff --check
```

- [ ] **Step 4: Independent review and corrections**

Require no unresolved Critical or Important finding on causal timing, exact decimals, schedule bounds, stop ordering, settlement accounting, roll behavior, or hostile public inputs.

- [ ] **Step 5: Commit release documentation**

```bash
git add README.md docs specs
git commit -m "docs: record futures execution milestone"
```

Do not push or merge until the complete branch is green and independently reviewed.
