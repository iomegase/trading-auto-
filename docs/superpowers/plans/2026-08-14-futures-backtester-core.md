# Futures Backtester Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver PR 2C.1 as a deterministic, exact-decimal, immutable accounting and portfolio kernel for the sequential futures backtester, without invoking strategy, risk sizing, or execution lifecycles yet.

**Architecture:** Add `@trading-auto/backtester` after the existing execution package. Model input events as bounded immutable values, order them by causal availability and fixed semantic priority, journal every cash movement through an exactly balanced append-only ledger, and apply internal pure portfolio transitions that rebuild and verify all aggregates after each event. Export only stable error, event, ledger, and read-only portfolio contracts; keep queue storage, reducers, validation helpers, and arithmetic private for PR 2C.2.

**Tech Stack:** TypeScript 7 native CLI with TypeScript 6 ESLint compatibility, pnpm workspaces, Vitest 4.1.10, `@js-temporal/polyfill` 0.5.1, `decimal.js` 10.6.0, and the existing domain, risk, and execution packages.

---

## PR boundary and invariants

PR 2C.1 implements only the state-machine kernel approved in
`docs/superpowers/specs/2026-08-14-futures-backtester-design.md`.

It must enforce all of the following before PR 2C.2 begins:

- account currency is exactly `EUR`;
- initialization is exactly `CASH +1000 / CAPITAL -1000`;
- `RiskPolicyVersion.initialCapital` is exactly `1000` and one approved policy is fixed for the run;
- `HISTORICAL_RESEARCH` is the only policy-use mode and `riskPolicyUseAt` equals `runCreatedAt`;
- no transition after initialization may post to `CAPITAL`;
- every cash change is explained by one exactly balanced ledger entry;
- decimals are canonical, bounded, and evaluated with a private clone unaffected by global `Decimal.set` calls;
- event ordering is by canonical `availableAt`, fixed priority, then a semantic ID restricted to printable non-space US-ASCII (`0x21`-`0x7E`), for which direct code-unit order is bytewise order, never insertion order;
- data after `endAt` is ignored before its remaining fields or payload are read;
- state and return values are deeply immutable and JSON-compatible;
- malformed public inputs throw typed errors rather than native `TypeError`, `RangeError`, or decimal-library errors;
- production code in `packages/backtester/src` reaches 100% statements, branches, functions, and lines.

## File map

- `packages/backtester/package.json`: workspace package and exact runtime dependencies.
- `packages/backtester/tsconfig.json`: composite project references.
- `packages/backtester/src/errors.ts`: stable typed errors and safe immutable details.
- `packages/backtester/src/validation.ts`: own-descriptor snapshots, bounded JSON cloning, and dense-array guards.
- `packages/backtester/src/decimal.ts`: private isolated exact-decimal arithmetic.
- `packages/backtester/src/event.ts`: event types, priorities, semantic IDs, and factory.
- `packages/backtester/src/clock.ts`: bounded causal filtering and deterministic ordering.
- `packages/backtester/src/ledger.ts`: exact balanced journal entries and append rules.
- `packages/backtester/src/portfolio.ts`: initial immutable state and aggregate contracts.
- `packages/backtester/src/reducer.ts`: internal pure transitions and invariant rebuild.
- `packages/backtester/src/index.ts`: deliberately small public ESM surface.
- `packages/backtester/test-helpers/builders.ts`: local valid upstream-object builders used only by tests.
- `docs/milestones/futures-backtester-core.md`: PR 2C.1 release and limitation note.

### Task 1: Scaffold `@trading-auto/backtester` and typed errors

**Files:**
- Create: `packages/backtester/package.json`
- Create: `packages/backtester/tsconfig.json`
- Create: `packages/backtester/src/errors.test.ts`
- Create: `packages/backtester/src/errors.ts`
- Create: `packages/backtester/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.test.json`
- Modify: `vitest.config.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the workspace shell and root project wiring**

Create a private ESM workspace package with these exact runtime dependencies:

```json
{
  "name": "@trading-auto/backtester",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@js-temporal/polyfill": "0.5.1",
    "@trading-auto/domain": "workspace:*",
    "@trading-auto/execution": "workspace:*",
    "@trading-auto/risk": "workspace:*",
    "decimal.js": "10.6.0"
  }
}
```

`packages/backtester/tsconfig.json` must extend the root base config, compile
`src/**/*.ts` except tests, and reference `../domain`, `../risk`, and
`../execution`. Add the package to root `tsconfig.json`, `tsconfig.test.json`
paths, and `vitest.config.ts` aliases. Run `pnpm install --lockfile-only` only
after the package manifest exists.

- [ ] **Step 2: Write the failing public error test**

```ts
import { describe, expect, it } from 'vitest';
import { BacktestInputError, BacktestStateError } from './index.js';

describe('backtester errors', () => {
  it('copies and freezes bounded details', () => {
    const source = { field: 'events', nested: { value: 'before' } };
    const error = new BacktestInputError(
      'INVALID_BACKTEST_INPUT',
      'invalid',
      source,
    );
    source.nested.value = 'after';

    expect(error).toMatchObject({
      name: 'BacktestInputError',
      code: 'INVALID_BACKTEST_INPUT',
      details: { field: 'events', nested: { value: 'before' } },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('uses a distinct invariant-failure class', () => {
    expect(
      new BacktestStateError('UNBALANCED_LEDGER', 'unbalanced'),
    ).toMatchObject({
      name: 'BacktestStateError',
      code: 'UNBALANCED_LEDGER',
    });
  });
});
```

- [ ] **Step 3: Run RED**

Run: `pnpm test packages/backtester/src/errors.test.ts`

Expected: FAIL because the classes are absent from the new barrel.

- [ ] **Step 4: Implement the stable taxonomy**

Use these exact public codes:

```ts
export type BacktestInputErrorCode =
  | 'INVALID_BACKTEST_INPUT'
  | 'BACKTEST_LIMIT_EXCEEDED'
  | 'DUPLICATE_EVENT';

export type BacktestStateErrorCode =
  | 'INVALID_BACKTEST_STATE'
  | 'EVENT_ORDER_VIOLATION'
  | 'UNBALANCED_LEDGER';

export class BacktestInputError extends Error {
  readonly code: BacktestInputErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class BacktestStateError extends Error {
  readonly code: BacktestStateErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
}
```

The constructor must bounded-clone and deep-freeze details rather than retain a
caller object. Error-detail cloning has maximum depth 16, maximum 1,024 nodes,
maximum 256 object keys, and maximum 10,000 array entries. Cycles and unreadable
values become deterministic marker strings; construction of an error must never
throw another native error.

- [ ] **Step 5: Run GREEN and focused gates**

Run:

```bash
pnpm test packages/backtester/src/errors.test.ts
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/backtester tsconfig.json tsconfig.test.json vitest.config.ts pnpm-lock.yaml
git commit -m "build: scaffold futures backtester package"
```

### Task 2: Bounded exact-decimal and hostile-input primitives

**Files:**
- Create: `packages/backtester/src/decimal.test.ts`
- Create: `packages/backtester/src/decimal.ts`
- Create: `packages/backtester/src/validation.test.ts`
- Create: `packages/backtester/src/validation.ts`

- [ ] **Step 1: Write RED tests for canonical bounded decimals**

Test the exact accepted domain:

```ts
expect(asBacktestDecimal('0', 'amount')).toBe('0');
expect(asBacktestDecimal('-12.50', 'amount')).toBe('-12.50');
expect(asBacktestNonnegativeDecimal('12.50', 'margin')).toBe('12.50');
expect(decimalSum(['0.1', '0.2'])).toBe('0.3');
```

Reject scientific notation, plus signs, leading zeroes, `-0`, non-strings,
more than 256 total digits, more than 128 fractional digits, and negative input
for the nonnegative helper. Arithmetic results outside the same 256/128 domain
must throw `INVALID_BACKTEST_INPUT` at the formatting boundary. Set global
Decimal precision/exponent limits to hostile values inside `try/finally` and
prove results are unchanged.

- [ ] **Step 2: Run decimal RED, implement the private clone, run GREEN**

Run: `pnpm test packages/backtester/src/decimal.test.ts`

Implement a module-private clone:

```ts
const BacktestDecimal = Decimal.clone({
  precision: 1024,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9e15,
  toExpPos: 9e15,
  maxE: 9e15,
  minE: -9e15,
});
```

Use the canonical regex and 256/128 bounds before constructing a Decimal. Do
not export the clone from `index.ts`.

- [ ] **Step 3: Write RED tests for own-descriptor snapshots**

The validation module must support:

```ts
const record = snapshotPlainRecord(input, 'input');
const value = readRequiredOwn(record, 'field', 'input.field');
const items = snapshotDenseArray(input, 'events', 1_000_000);
const payload = snapshotJsonObject(input, 'payload');
```

Tests must prove:

- inherited required properties are rejected;
- a getter is invoked exactly once;
- a divergent Proxy `get` trap cannot replace the captured descriptor value;
- revoked proxies and descriptor traps become `BacktestInputError`;
- sparse arrays and invalid lengths are rejected;
- the limit is checked before probing index zero;
- symbols, functions, `undefined`, bigint, non-finite numbers, cycles, class
  instances, and unsupported prototypes are rejected from business payloads;
- null-prototype records and reserved keys such as `__proto__` survive as own
  frozen data properties without prototype pollution;
- returned records and arrays are deeply frozen and detached from input.

- [ ] **Step 4: Run validation RED, implement, and run GREEN**

Run: `pnpm test packages/backtester/src/validation.test.ts`

Use `Object.getOwnPropertyDescriptor` exactly once per required field and read
either `descriptor.value` or invoke an own getter once. Never follow with
`input[field]`, `Object.hasOwn`, or a second descriptor read. Build output
dictionaries with `Object.create(null)` and `Object.defineProperty`.

- [ ] **Step 5: Run task gates and commit**

```bash
pnpm test packages/backtester/src/decimal.test.ts packages/backtester/src/validation.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
git diff --check
git add packages/backtester/src/decimal.ts packages/backtester/src/decimal.test.ts packages/backtester/src/validation.ts packages/backtester/src/validation.test.ts
git commit -m "feat(backtester): validate bounded immutable inputs"
```

### Task 3: Immutable event contracts and semantic identity

**Files:**
- Create: `packages/backtester/src/event.test.ts`
- Create: `packages/backtester/src/event.ts`
- Modify: `packages/backtester/src/index.ts`

- [ ] **Step 1: Write RED tests for all nine event types**

Lock the public contract:

```ts
export const BACKTEST_EVENT_TYPES = [
  'DATA_AVAILABLE',
  'CLOSED_BAR_POSITION',
  'DAILY_SETTLEMENT',
  'ROLL',
  'OPEN_EXIT',
  'OPEN_ENTRY',
  'SIGNAL_DECISION',
  'PORTFOLIO_SNAPSHOT',
  'SESSION_END',
] as const;

export interface BacktestEventInput {
  semanticId: string;
  type: string;
  availableAt: string;
  instrumentId: string | null;
  contractId: string | null;
  version: string | null;
  payload: Readonly<Record<string, unknown>>;
}
```

Use an explicit `null` for absent provenance; optional or missing provenance is
not accepted. A representative test is:

```ts
expect(
  createBacktestEvent({
    semanticId: 'FDXS-202609:bar:2026-08-14T09:00:00Z',
    type: 'CLOSED_BAR_POSITION',
    availableAt: '2026-08-14T09:00:00+00:00',
    instrumentId: 'FDXS',
    contractId: 'FDXS-202609',
    version: 'DATASET_1',
    payload: { close: '24500' },
  }),
).toMatchObject({
  availableAt: '2026-08-14T09:00:00Z',
  type: 'CLOSED_BAR_POSITION',
});
```

Test all type priorities, blank identifiers, invalid type, noncanonical input
instants normalizing to UTC, payload rejection, own-property enforcement,
getter one-read behavior, deep detachment, and freeze.

- [ ] **Step 2: Run RED**

Run: `pnpm test packages/backtester/src/event.test.ts`

Expected: FAIL because `createBacktestEvent` is absent.

- [ ] **Step 3: Implement the exact event value and priority map**

```ts
export type BacktestEventType = (typeof BACKTEST_EVENT_TYPES)[number];

export const BACKTEST_EVENT_PRIORITY: Readonly<
  Record<BacktestEventType, number>
> = Object.freeze({
  DATA_AVAILABLE: 0,
  CLOSED_BAR_POSITION: 1,
  DAILY_SETTLEMENT: 2,
  ROLL: 3,
  OPEN_EXIT: 4,
  OPEN_ENTRY: 5,
  SIGNAL_DECISION: 6,
  PORTFOLIO_SNAPSHOT: 7,
  SESSION_END: 8,
});

export interface BacktestEvent {
  readonly semanticId: string;
  readonly type: BacktestEventType;
  readonly priority: number;
  readonly availableAt: InstantString;
  readonly instrumentId: string | null;
  readonly contractId: string | null;
  readonly version: string | null;
  readonly payload: JsonObject;
}
```

The semantic ID is supplied by the producing boundary and validated as a stable
logical identity containing only printable non-space US-ASCII characters
(`0x21`-`0x7E`); no array index or random value is introduced.

- [ ] **Step 4: Run GREEN, export the stable contract, and commit**

```bash
pnpm test packages/backtester/src/event.test.ts
pnpm typecheck
pnpm lint
git add packages/backtester/src/event.ts packages/backtester/src/event.test.ts packages/backtester/src/index.ts
git commit -m "feat(backtester): model immutable causal events"
```

### Task 4: Deterministic bounded clock

**Files:**
- Create: `packages/backtester/src/clock.test.ts`
- Create: `packages/backtester/src/clock.ts`
- Modify: `packages/backtester/src/index.ts`

- [ ] **Step 1: Write RED ordering and causality tests**

Define the public pure operation:

```ts
export interface OrderBacktestEventsInput {
  endAt: string;
  events: readonly BacktestEventInput[];
}

export function orderBacktestEvents(
  input: OrderBacktestEventsInput,
): readonly BacktestEvent[];
```

Cover these exact cases:

- every permutation of the nine types at one instant produces the fixed
  priority order;
- equal time and type sort printable non-space US-ASCII semantic IDs by direct
  code-unit comparison (`a.semanticId < b.semanticId`), which is exactly their
  bytewise order, not `localeCompare`;
- offset-equivalent instants normalize before sorting;
- exact duplicate semantic IDs reject with `DUPLICATE_EVENT`;
- contradictory duplicate semantic IDs also reject with `DUPLICATE_EVENT`;
- 1,000,000 items is accepted and 1,000,001 rejects before index probing;
- sparse input rejects;
- appending an event with `availableAt > endAt` leaves output deeply equal;
- for a future event, getters for semantic ID, type, provenance, and payload are
  never read: only its own `availableAt` descriptor is captured;
- malformed eligible events throw and are never silently skipped.

- [ ] **Step 2: Run RED**

Run: `pnpm test packages/backtester/src/clock.test.ts`

Expected: FAIL because the clock is absent.

- [ ] **Step 3: Implement routing-first filtering and total ordering**

The algorithm is exact:

```text
snapshot top-level input and endAt
snapshot events array length/density with cap 1,000,000
for each raw item:
  capture only availableAt
  normalize it with Temporal.Instant
  if availableAt > endAt: continue without reading another field
  otherwise createBacktestEvent from a descriptor snapshot
reject every duplicate eligible semanticId
sort by Temporal.Instant.compare
then numeric priority
then semanticId using < and >
return a frozen array
```

Add an internal `clockKeyOf(event)` returning
`<availableAt>|<two-digit-priority>|<semanticId>`. It remains unexported and is
used by the reducer to enforce monotonic transitions.

- [ ] **Step 4: Run GREEN and determinism stress**

Run:

```bash
pnpm test packages/backtester/src/clock.test.ts
pnpm test packages/backtester/src/clock.test.ts --repeat 10
pnpm typecheck
pnpm lint
```

If this Vitest version does not support `--repeat`, replace only that command
with a deterministic loop inside one test over 100 seeded permutations; do not
add random non-seeded behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/backtester/src/clock.ts packages/backtester/src/clock.test.ts packages/backtester/src/index.ts
git commit -m "feat(backtester): order causal events deterministically"
```

### Task 5: Exact balanced append-only ledger

**Files:**
- Create: `packages/backtester/src/ledger.test.ts`
- Create: `packages/backtester/src/ledger.ts`
- Modify: `packages/backtester/src/index.ts`

- [ ] **Step 1: Write RED ledger tests**

Lock the public contract:

```ts
export type LedgerAccount =
  | 'CASH'
  | 'CAPITAL'
  | 'COSTS'
  | 'PNL_CLEARING'
  | 'FX_TRANSLATION';

export interface LedgerPostingInput {
  account: string;
  amount: string;
}

export interface LedgerEntryInput {
  entryId: string;
  eventId: string;
  occurredAt: string;
  description: string;
  fxSnapshotVersion: string | null;
  postings: readonly LedgerPostingInput[];
}

export type BacktestLedger = readonly Readonly<LedgerEntry>[];
```

Test these entries exactly:

```ts
createInitialLedger({
  backtestId: 'BT-1',
  runCreatedAt: '2026-08-14T08:00:00Z',
});
// CASH +1000 / CAPITAL -1000

createLedgerEntry({
  entryId: 'cost:fill-1',
  eventId: 'fill-1',
  occurredAt: '2026-08-14T09:00:00Z',
  description: 'Round-trip execution cost',
  fxSnapshotVersion: null,
  postings: [
    { account: 'CASH', amount: '-2.40' },
    { account: 'COSTS', amount: '2.40' },
  ],
});
```

Also test domestic profit/loss through `PNL_CLEARING` and foreign profit/loss
through `FX_TRANSLATION` with a non-null FX version. Require 2 through 32 dense
postings, unique accounts, non-zero amounts, both signs, and exact zero sum.
Reject duplicate entry IDs, chronology regression, malformed inputs, reserved
keys, hostile proxies, and a ledger longer than 1,000,000 entries. Prove input
mutation and Decimal global configuration cannot affect output.

- [ ] **Step 2: Run RED**

Run: `pnpm test packages/backtester/src/ledger.test.ts`

Expected: FAIL because the ledger factory is absent.

- [ ] **Step 3: Implement factories and append rules**

```ts
export function createLedgerEntry(input: LedgerEntryInput): LedgerEntry;

export function createInitialLedger(input: {
  backtestId: string;
  runCreatedAt: string;
}): BacktestLedger;

export function appendLedgerEntry(
  ledger: BacktestLedger,
  entry: LedgerEntryInput,
): BacktestLedger;
```

`appendLedgerEntry` snapshots both arguments, rejects duplicate IDs, requires
`occurredAt >=` the last entry timestamp, and returns a new frozen array without
mutating the previous ledger. `createLedgerEntry` converts no currencies; it
only validates an already-account-currency balanced journal value.

- [ ] **Step 4: Run GREEN, verify exact arithmetic, and commit**

```bash
pnpm test packages/backtester/src/ledger.test.ts
pnpm typecheck
pnpm lint
git add packages/backtester/src/ledger.ts packages/backtester/src/ledger.test.ts packages/backtester/src/index.ts
git commit -m "feat(backtester): journal exact balanced cash flows"
```

### Task 6: Initialize the immutable portfolio state

**Files:**
- Create: `packages/backtester/src/portfolio.test.ts`
- Create: `packages/backtester/src/portfolio.ts`
- Modify: `packages/backtester/src/index.ts`

- [ ] **Step 1: Write RED initialization tests**

Define the public initialization boundary:

```ts
export interface BacktestPortfolioStateInput {
  backtestId: string;
  runCreatedAt: string;
  riskPolicyUseMode: string;
  riskPolicyUseAt: string;
  policy: Readonly<RiskPolicyInput>;
}

export function createBacktestPortfolioState(
  input: BacktestPortfolioStateInput,
): BacktestPortfolioState;
```

The expected baseline is exact:

```ts
expect(state).toMatchObject({
  operatingStatus: 'RUNNING',
  accountCurrency: 'EUR',
  initialCash: '1000',
  cash: '1000',
  realizedEquity: '1000',
  unrealizedPnl: '0',
  sizingEquity: '1000',
  usedMargin: '0',
  reservedMargin: '0',
  availableFunds: '1000',
  grossExposure: '0',
  reservedGrossExposure: '0',
  openRisk: '0',
  dailyLoss: '0',
  drawdownPct: '0',
  processedEventCount: 0,
  lastClockKey: null,
});
expect(state.positions).toEqual([]);
expect(state.activeEntryIntents).toEqual([]);
expect(state.activeContractByInstrument).toEqual({});
expect(state.dailySnapshots).toEqual([]);
expect(state.ledger[0]?.postings).toEqual([
  { account: 'CASH', amount: '1000' },
  { account: 'CAPITAL', amount: '-1000' },
]);
```

Use a real `createRiskPolicy`-compatible fixture. Test rejection of:

- policy not `APPROVED`;
- non-EUR reference or account currency;
- `initialCapital` other than exactly numeric 1000;
- `allowCashInjection` other than false;
- mode other than `HISTORICAL_RESEARCH`;
- `riskPolicyUseAt !== runCreatedAt` after instant normalization;
- `approvedAt > activatedAt` or `activatedAt > runCreatedAt`;
- malformed/hostile inputs.

Test two independent runs: baseline `maxSizingCapital=1000`, and a separately
approved preactivated policy with `maxSizingCapital=1200`. The state may store
the higher fixed cap but must still start with sizing equity 1000; no automatic
cap mutation exists.

- [ ] **Step 2: Run RED**

Run: `pnpm test packages/backtester/src/portfolio.test.ts`

Expected: FAIL because the portfolio factory is absent.

- [ ] **Step 3: Implement the exact read-only state**

```ts
export type BacktestOperatingStatus = 'RUNNING' | 'NO_NEW_ENTRIES';

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
```

Lock the nested public contracts exactly:

```ts
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
```

These types are public read-only result contracts, but PR 2C.1 does not expose
public mutation factories for them.

Validate the policy with `createRiskPolicy`, calculate initial sizing through
`calculateSizingEquity`, create the initial ledger through
`createInitialLedger`, and deep-freeze the assembled state.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm test packages/backtester/src/portfolio.test.ts
pnpm typecheck
pnpm lint
git add packages/backtester/src/portfolio.ts packages/backtester/src/portfolio.test.ts packages/backtester/src/index.ts
git commit -m "feat(backtester): initialize immutable portfolio state"
```

### Task 7: Pure portfolio transitions and invariant rebuild

**Files:**
- Create: `packages/backtester/src/reducer.test.ts`
- Create: `packages/backtester/src/reducer.ts`
- Create: `packages/backtester/test-helpers/builders.ts`
- Modify: `packages/backtester/src/portfolio.ts`

- [ ] **Step 1: Build valid test objects only through public upstream APIs**

Create local test-only builders that use `createRiskPolicy`,
`createEntryIntent`, `createOpenPosition`, and the public risk factories. Do not
copy private builders from sibling packages or export these helpers from the
package barrel.

The builders must make overrides explicit and preserve exact optional-property
semantics. They must not hide invalid production defaults.

- [ ] **Step 2: Write RED lifecycle-transition tests**

Keep the reducer internal. Use this exact discriminated transition set:

```ts
type BacktestPortfolioTransition =
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
```

Test transition behavior in this order:

1. register and cancel one intent without cash movement;
2. open a position atomically removes its intent, posts entry cost, and stores
   one position;
3. revalue changes no cash or realized equity, raises unrealized gain without
   raising sizing, and immediately lowers sizing on unrealized loss;
4. accounting applies settlement/P&L or costs and updates an optional remaining
   position;
5. close removes the position and posts its realized cash result;
6. `SET_ENTRY_CAPACITY(false)` enters `NO_NEW_ENTRIES` while accounting,
   revaluation, and close transitions still work;
7. a later `SET_ENTRY_CAPACITY(true)` returns to `RUNNING` only after the caller
   has causally restored prerequisites;
8. setting/removing an active dated contract produces a sorted immutable
   instrument map without changing accounting;
9. recording a portfolio snapshot copies the current totals and counts at the
   event's canonical availability time, appends once, and cannot rewrite prior
   snapshots.

Require compatible event types: `REGISTER_INTENT` uses `SIGNAL_DECISION`;
`CANCEL_INTENT` and `OPEN_POSITION` use `OPEN_ENTRY`; `REVALUE_POSITION` uses
`CLOSED_BAR_POSITION`; `APPLY_ACCOUNTING` uses `DAILY_SETTLEMENT`, `ROLL`,
`OPEN_EXIT`, or `CLOSED_BAR_POSITION`; `CLOSE_POSITION` uses
`CLOSED_BAR_POSITION`, `OPEN_EXIT`, or `ROLL`; `SET_ACTIVE_CONTRACT` uses
`DATA_AVAILABLE` or `ROLL`; and `RECORD_PORTFOLIO_SNAPSHOT` uses
`PORTFOLIO_SNAPSHOT`. `SET_ENTRY_CAPACITY` may accompany any lifecycle event
because a restored or lost prerequisite can follow any causal state change.

- [ ] **Step 3: Write RED invariant tests**

Each reducer call must reject:

- `clockKeyOf(transition.event) < state.lastClockKey` with
  `EVENT_ORDER_VIOLATION`;
- an unknown or missing intent/position lifecycle identity;
- duplicate positions, duplicate intents, same-instrument pyramiding, or hedge;
- inconsistent execution/risk instrument, contract, direction, or quantity;
- a ledger `eventId` different from `transition.event.semanticId`;
- a ledger cash posting different from `cashChange`;
- any post-initialization `CAPITAL` posting;
- a positive cash change balanced by `CAPITAL` or any unexplained deposit;
- duplicate ledger entry IDs;
- malformed canonical amounts or negative margins/exposures/open risk;
- aggregate mismatch after rebuilding;
- caller mutation of old or returned state.

For accepted cash movements, require the balancing account to be exactly one of
`COSTS`, `PNL_CLEARING`, or `FX_TRANSLATION`. A foreign result uses
`FX_TRANSLATION` instead of also posting to `PNL_CLEARING`.

- [ ] **Step 4: Run RED**

Run: `pnpm test packages/backtester/src/reducer.test.ts`

Expected: FAIL because `reduceBacktestPortfolio` is absent.

- [ ] **Step 5: Implement the pure reducer and aggregate rebuild**

```ts
function reduceBacktestPortfolio(
  state: BacktestPortfolioState,
  transition: BacktestPortfolioTransition,
): BacktestPortfolioState;
```

For every accepted transition:

```text
snapshot the transition and its BacktestEvent exactly once
derive clockKey internally and assert it is monotonic
apply the one discriminated lifecycle change to new arrays
sort positions by positionId and intents by intentId
sort active-contract keys bytewise and append snapshots chronologically
validate risk positions/intents with createRiskPortfolioState
sum position margin, exposure, open risk, and unrealized P&L exactly
sum intent reservations exactly
rebuild risk-group exposure from positions plus intent reservations
derive availableFunds = cash + unrealizedPnl - usedMargin - reservedMargin
validate the risk account with usedMargin + reservedMargin as committed margin
derive sizingEquity with calculateSizingEquity and the run's fixed policy
append and reconcile any ledger entry
assert cash = 1000 + every CASH posting
assert realizedEquity = cash
increment processedEventCount once
deep-freeze and return a new state
```

The reducer must use only `state.policy` when recalculating sizing. It must never
mutate or change the policy, `runCreatedAt`,
`riskPolicyUseAt`, `backtestId`, account currency, or initial cash. Do not export
the reducer or transition type from `src/index.ts`; PR 2C.2 will call it inside
the package.

- [ ] **Step 6: Run GREEN, coverage, and commit**

```bash
pnpm test packages/backtester/src/reducer.test.ts
pnpm exec vitest run packages/backtester/src --coverage
pnpm typecheck
pnpm lint
git diff --check
git add packages/backtester/src/reducer.ts packages/backtester/src/reducer.test.ts packages/backtester/src/portfolio.ts packages/backtester/test-helpers/builders.ts
git commit -m "feat(backtester): reduce exact portfolio transitions"
```

Expected: reducer suite passes. Any uncovered production branch must be covered
with a meaningful test or removed as unreachable before moving on.

### Task 8: Adversarial integration and public-boundary lock

**Files:**
- Create: `packages/backtester/src/backtester-core.test.ts`
- Modify: `packages/backtester/src/index.ts`
- Modify as findings require: `packages/backtester/src/errors.ts`
- Modify as findings require: `packages/backtester/src/validation.ts`
- Modify as findings require: `packages/backtester/src/event.ts`
- Modify as findings require: `packages/backtester/src/clock.ts`
- Modify as findings require: `packages/backtester/src/ledger.ts`
- Modify as findings require: `packages/backtester/src/portfolio.ts`
- Modify as findings require: `packages/backtester/src/reducer.ts`

- [ ] **Step 1: Write the causal integration RED test**

Starting from one initialized portfolio, order a deterministic event sequence,
apply internal transitions, and assert:

- exact initialization balance;
- same-instant `CLOSED_BAR_POSITION` precedes settlement/open events;
- a stopped position is absent before later same-instant settlement/open work;
- ledger and cash reconcile after every state;
- repeated input permutations produce deeply equal states;
- appending a future hostile event produces a deeply equal state and does not
  read the hostile payload.

- [ ] **Step 2: Lock the exact public runtime surface**

`src/index.ts` must export these runtime values and no internal helper:

```text
BACKTEST_EVENT_PRIORITY
BACKTEST_EVENT_TYPES
BacktestInputError
BacktestStateError
appendLedgerEntry
createBacktestEvent
createBacktestPortfolioState
createInitialLedger
createLedgerEntry
orderBacktestEvents
```

It may export the associated public TypeScript types. It must not export the
Decimal clone, validation helpers, clock key, reducer, transition types, or test
builders. Add a built-ESM test that compares `Object.keys(await
import('@trading-auto/backtester'))` with the exact sorted list above.

- [ ] **Step 3: Complete the hostile boundary matrix**

For every public factory, include non-object, inherited, non-enumerable,
getter, revoked Proxy, descriptor trap, sparse array, over-limit, forged cast,
cycle, mutation-after-call, and Decimal-contamination cases applicable to that
boundary. Assert stable typed codes and stable details, not only `toThrow()`.

- [ ] **Step 4: Run package coverage and fix only demonstrated gaps**

Run:

```bash
pnpm exec vitest run packages/backtester/src --coverage
```

Expected for `packages/backtester/src`: 100% statements, 100% branches, 100%
functions, and 100% lines. Write a failing regression test before every code
change found during this hardening pass.

- [ ] **Step 5: Run repository gates and commit**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test packages/backtester/src
pnpm test
pnpm build
pnpm check
git diff --check
git add packages/backtester
git commit -m "test(backtester): harden causal accounting kernel"
```

Expected: every command exits 0; the full test count is greater than the
baseline 1,032 tests.

### Task 9: PR 2C.1 documentation and release verification

**Files:**
- Create: `docs/milestones/futures-backtester-core.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-14-futures-backtester-design.md`

- [ ] **Step 1: Write the release note**

Document:

- status `RESEARCH_ONLY`;
- exact PR 2C.1 scope and exported surface;
- baseline `1_000 EUR` and no cash injection;
- fixed approved risk policy and `HISTORICAL_RESEARCH` chronology;
- deterministic event priority;
- ledger accounts and exact-balance invariant;
- `RUNNING` / `NO_NEW_ENTRIES` semantics;
- hostile input limits;
- commands and final test/coverage counts;
- explicit deferral of strategy/execution orchestration to PR 2C.2 and final
  result/metrics to PR 2C.3.

- [ ] **Step 2: Synchronize top-level status**

Add `@trading-auto/backtester` to README as an implemented kernel, without
claiming an operational backtest runner. Change only the relevant design status
to `PR 2C.1 implemented; PR 2C.2 and PR 2C.3 remain planned`. Preserve all
execution, broker, persistence, API, and UI deferrals.

- [ ] **Step 3: Run final verification from a clean dependency state**

```bash
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm check
git diff --check
```

Expected:

- production audit reports no known vulnerability;
- all repository gates pass;
- backtester production coverage is exactly 100% in all four dimensions;
- no generated `dist`, coverage artifact, cache file, or unrelated worktree
  content is staged.

If network access prevents `pnpm audit --prod`, do not claim the security gate
passed and do not open the PR until the audit is rerun successfully with network
access.

- [ ] **Step 4: Review the diff against the approved boundary**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
```

Confirm there is no orchestration, metric, persistence, broker, API, UI, or
deployment code in the branch.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/milestones/futures-backtester-core.md docs/superpowers/specs/2026-08-14-futures-backtester-design.md
git commit -m "docs: document futures backtester core"
```

### Task 10: Independent review and PR handoff

**Files:**
- Modify only files required by demonstrated review findings.

- [ ] **Step 1: Request a specification review**

Review the complete branch against the approved design, this plan, and the
public contracts of domain/risk/execution. Findings must include exact file and
line evidence and be categorized Critical, Important, or Minor.

- [ ] **Step 2: Request an adversarial quality review**

Focus on future-data reads before routing, Proxy/descriptor TOCTOU, collection
caps before index/Decimal construction, exact ledger balance, no cash injection,
Decimal global contamination, identity duplicates, event-order determinism,
state reconciliation, public export leakage, and vacuous tests.

- [ ] **Step 3: Correct confirmed findings in strict TDD**

For each confirmed finding, first add a focused failing regression, then make
the smallest production correction, then rerun focused and full gates. Do not
implement speculative reviewer suggestions without reproducing the issue.

- [ ] **Step 4: Run the final fresh gate and publish only when green**

```bash
pnpm audit --prod
pnpm check
pnpm test:coverage
git diff --check origin/main...HEAD
git status --short
```

Expected: clean worktree, successful audit/check/coverage, backtester at 100%,
and no unresolved Critical or Important review finding. Then push
`agent/futures-backtester-core`, open a PR to `main`, let CI and CodeRabbit run
as asynchronous pre-merge controls, address confirmed findings in TDD, and
merge only when all required checks are green.
