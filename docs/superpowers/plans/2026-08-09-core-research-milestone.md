# Core Research Milestone Implementation Plan

> **Historical plan — superseded.** This file records the initial milestone
> implementation sequence and must not be used as the current contract. The
> authoritative follow-up is the
> [Core Research Hardening Implementation Plan](2026-08-09-core-research-hardening.md),
> which requires causal H1/H4 prefixes, versioned provenance, the internal raw
> candidate evaluator, and exact tick-aligned stops.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible TypeScript research core that validates candles, selects only available closed trend candles, computes causally aligned Ichimoku values, evaluates the H4/H1 baseline, and proves those behaviors with regression and causality tests.

**Architecture:** Use a pnpm workspace with five focused packages and TypeScript project references. All production functions are pure, runtime inputs are validated in the domain package, and the indicator/strategy packages never access a global clock or future array positions.

**Tech Stack:** Node.js 22, pnpm 10, TypeScript 7.0.2, Vitest 4.1.10, decimal.js 10.6.0, Zod 4.4.3, Temporal polyfill 0.5.1, ESLint 10.8.1, typescript-eslint 8.66.0, Prettier 3.9.6.

---

## File map

```text
package.json                         root scripts and pinned toolchain
pnpm-workspace.yaml                 workspace package discovery
tsconfig.base.json                  shared strict compiler options
tsconfig.json                       project references
eslint.config.mjs                   static-analysis rules
prettier.config.mjs                 formatting rules
vitest.config.ts                    package aliases and test discovery
packages/domain/                    validated domain values and candles
packages/calendars/                 temporal eligibility and H4 selection
packages/indicators/                causal Ichimoku calculation
packages/strategy-ichimoku/         breakout, regime, candidate and stop
packages/test-helpers/              deterministic candle datasets
```

### Task 1: Scaffold the reproducible workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `vitest.config.ts`
- Create: `packages/{domain,calendars,indicators,strategy-ichimoku,test-helpers}/package.json`
- Create: `packages/{domain,calendars,indicators,strategy-ichimoku,test-helpers}/tsconfig.json`

- [ ] **Step 1: Create the root manifest and workspace declaration**

Create `package.json`:

```json
{
  "name": "trading-auto",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": ">=22.15.0" },
  "scripts": {
    "build": "tsc -b",
    "clean": "tsc -b --clean",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc -b --pretty false",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "22.20.1",
    "@vitest/coverage-v8": "4.1.10",
    "eslint": "10.8.1",
    "prettier": "3.9.6",
    "typescript": "7.0.2",
    "typescript-eslint": "8.66.0",
    "vitest": "4.1.10"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

- [ ] **Step 2: Create strict TypeScript project references**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

Create root `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "packages/domain" },
    { "path": "packages/calendars" },
    { "path": "packages/indicators" },
    { "path": "packages/strategy-ichimoku" },
    { "path": "packages/test-helpers" }
  ]
}
```

Each package `tsconfig.json` extends `../../tsconfig.base.json`, sets `composite: true`, `rootDir: "src"`, `outDir: "dist"`, and includes `src/**/*.ts`. Use this exact domain config:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

Use the same fields for other packages and add `references`: `calendars` and `test-helpers` reference `../domain`; `indicators` references `../domain`; `strategy-ichimoku` references `../domain` and `../indicators`.

- [ ] **Step 3: Create package manifests**

Each package uses this shape, with its own name and workspace dependencies:

```json
{
  "name": "@trading-auto/domain",
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
    "decimal.js": "10.6.0",
    "zod": "4.4.3"
  }
}
```

The remaining manifests use the same metadata and exports, with these exact dependency objects:

```json
// calendars/package.json and test-helpers/package.json
{ "@trading-auto/domain": "workspace:*" }

// indicators/package.json
{ "@trading-auto/domain": "workspace:*" }

// strategy-ichimoku/package.json
{
  "@trading-auto/domain": "workspace:*",
  "@trading-auto/indicators": "workspace:*"
}
```

- [ ] **Step 4: Configure Vitest, ESLint and Prettier**

Create `vitest.config.ts`:

```ts
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@trading-auto/domain': source('./packages/domain/src/index.ts'),
      '@trading-auto/calendars': source('./packages/calendars/src/index.ts'),
      '@trading-auto/indicators': source('./packages/indicators/src/index.ts'),
      '@trading-auto/strategy-ichimoku': source('./packages/strategy-ichimoku/src/index.ts'),
      '@trading-auto/test-helpers': source('./packages/test-helpers/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/index.ts', 'packages/**/*.test.ts'],
    },
  },
});
```

Create `eslint.config.mjs`:

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '.worktrees/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
```

Create `prettier.config.mjs`:

```js
export default { singleQuote: true, semi: true, trailingComma: 'all' };
```

- [ ] **Step 5: Install and verify the empty workspace**

Run:

```bash
pnpm install
pnpm exec tsc --version
pnpm exec vitest --version
```

Expected: lockfile created; TypeScript reports `7.0.2`; Vitest reports `4.1.10`.

- [ ] **Step 6: Commit the scaffold**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.mjs prettier.config.mjs vitest.config.ts packages
git commit -m "build: scaffold research core workspace"
```

### Task 2: Implement validated domain primitives with TDD

**Files:**
- Create: `packages/domain/src/decimal.ts`
- Create: `packages/domain/src/time.ts`
- Create: `packages/domain/src/candle.ts`
- Create: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/src/decimal.test.ts`
- Test: `packages/domain/src/candle.test.ts`

- [ ] **Step 1: Write failing decimal and candle tests**

Tests must assert that `asDecimalString('101.50')` succeeds, non-canonical or non-finite values fail, a valid closed candle is created, invalid OHLC values fail, non-positive prices fail, and `availableAt < closeTime` fails for a closed candle.

Use this public API in the tests:

```ts
const value = asDecimalString('101.50');
const candle = createCandle({
  instrumentId: 'TEST',
  timeframe: '1h',
  sourceTimestamp: '2026-01-01T09:00:00+01:00',
  sourceTimezone: 'Europe/Paris',
  exchangeTimezone: 'Europe/Paris',
  openTime: '2026-01-01T08:00:00Z',
  closeTime: '2026-01-01T09:00:00Z',
  availableAt: '2026-01-01T09:00:01Z',
  ingestedAt: '2026-01-01T09:00:02Z',
  open: '100', high: '102', low: '99', close: '101.5',
  isClosed: true,
  provider: 'synthetic',
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm test packages/domain/src/decimal.test.ts packages/domain/src/candle.test.ts
```

Expected: FAIL because `@trading-auto/domain` exports do not exist.

- [ ] **Step 3: Implement the minimal domain API**

Implement a branded `DecimalString`, `asDecimalString`, `InstantString`, `asInstantString`, `Timeframe = '1h' | '4h'`, `DomainValidationError`, `Candle`, `CandleInput`, and `createCandle`. Use `Decimal` for OHLC comparisons and `Temporal.Instant.compare` for timestamp order. Return immutable objects.

`asDecimalString` accepts the canonical regex `^-?(0|[1-9]\d*)(\.\d+)?$` and rejects values that Decimal considers non-finite. `createCandle` validates positive OHLC values and all OHLC invariants before branding its timestamps and decimals.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm test packages/domain/src/decimal.test.ts packages/domain/src/candle.test.ts
pnpm typecheck
```

Expected: all domain tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit domain primitives**

```bash
git add packages/domain
git commit -m "feat(domain): validate decimal candles"
```

### Task 3: Add deterministic test data and temporal selection

**Files:**
- Create: `packages/test-helpers/src/candles.ts`
- Create: `packages/test-helpers/src/index.ts`
- Create: `packages/calendars/src/availability.ts`
- Create: `packages/calendars/src/index.ts`
- Test: `packages/calendars/src/availability.test.ts`

- [ ] **Step 1: Write the failing temporal-alignment test**

Create candles at 08:00, 12:00, and 16:00. Assert that:

```ts
expect(selectLatestAvailableClosedCandle(candles, '2026-01-01T13:00:00Z'))
  .toMatchObject({ closeTime: '2026-01-01T12:00:00Z' });
```

Also assert that an unfinished 16:00 H4 candle is excluded, a 12:00 candle with `availableAt` 13:05 is excluded at 13:00, and a candle is included when `availableAt === decisionAt`.

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm test packages/calendars/src/availability.test.ts
```

Expected: FAIL because the selection function is missing.

- [ ] **Step 3: Implement candle builders and temporal selection**

`buildCandle(overrides)` creates a valid deterministic candle through `createCandle`. Implement:

```ts
export function selectLatestAvailableClosedCandle(
  candles: readonly Candle[],
  decisionAt: InstantString,
): Candle | null;
```

Filter on `isClosed` and `availableAt <= decisionAt`, then select the greatest `closeTime`. Do not mutate or sort the input array in place.

- [ ] **Step 4: Run the test and verify GREEN**

```bash
pnpm test packages/calendars/src/availability.test.ts
pnpm typecheck
```

Expected: temporal-alignment tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit temporal alignment**

```bash
git add packages/calendars packages/test-helpers
git commit -m "feat(calendars): select available closed candles"
```

### Task 4: Compute Ichimoku without future leakage

**Files:**
- Create: `packages/indicators/src/ichimoku.ts`
- Create: `packages/indicators/src/index.ts`
- Test: `packages/indicators/src/ichimoku.test.ts`

- [ ] **Step 1: Write failing index and alignment tests**

Generate 90 deterministic candles and call:

```ts
const points = computeIchimoku(candles, {
  tenkanPeriod: 9,
  kijunPeriod: 26,
  senkouBPeriod: 52,
  displacement: 26,
  kijunSlopeLookback: 5,
});
```

Assert the first non-null indexes: Tenkan 8, Kijun 25, raw Senkou A 25, raw Senkou B 51, current cloud A 51, current cloud B 77. Create a synthetic regime shift and assert `points[77].currentCloudB === points[51].senkouBRaw` while `points[77].senkouBRaw` differs.

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm test packages/indicators/src/ichimoku.test.ts
```

Expected: FAIL because `computeIchimoku` is missing.

- [ ] **Step 3: Implement pure Ichimoku calculation**

Export `IchimokuConfig`, `CloudDirection`, `IchimokuPoint`, and:

```ts
export function computeIchimoku(
  candles: readonly Candle[],
  config: Readonly<IchimokuConfig>,
): readonly IchimokuPoint[];
```

Use rolling-window highs/lows without reading past the current index. Keep raw spans at their calculation index. Derive current cloud values only from `index - displacement`; never shift the output array for display.

- [ ] **Step 4: Run the test and verify GREEN**

```bash
pnpm test packages/indicators/src/ichimoku.test.ts
pnpm typecheck
```

Expected: all index and current-Kumo assertions pass.

- [ ] **Step 5: Commit indicators**

```bash
git add packages/indicators
git commit -m "feat(indicators): compute causal Ichimoku cloud"
```

### Task 5: Implement breakout, H4 regime and Kijun stop

**Files:**
- Create: `packages/strategy-ichimoku/src/breakout.ts`
- Create: `packages/strategy-ichimoku/src/regime.ts`
- Create: `packages/strategy-ichimoku/src/stop.ts`
- Create: `packages/strategy-ichimoku/src/index.ts`
- Test: `packages/strategy-ichimoku/src/breakout.test.ts`
- Test: `packages/strategy-ichimoku/src/regime.test.ts`
- Test: `packages/strategy-ichimoku/src/stop.test.ts`

- [ ] **Step 1: Write failing breakout tests**

Assert LONG only when `close[t]` is strictly above the maximum high in `[t-N, t-1]`, SHORT only when strictly below the previous minimum low, equality returns `NONE`, the current candle high/low is excluded, and insufficient history returns `INSUFFICIENT_DATA`.

- [ ] **Step 2: Run breakout tests and verify RED**

```bash
pnpm test packages/strategy-ichimoku/src/breakout.test.ts
```

Expected: FAIL because `detectBreakout` is missing.

- [ ] **Step 3: Implement breakout and verify GREEN**

Export:

```ts
type BreakoutResult =
  | { status: 'LONG' | 'SHORT' | 'NONE' }
  | { status: 'INSUFFICIENT_DATA' };

function detectBreakout(
  candles: readonly Candle[],
  index: number,
  lookback: number,
): BreakoutResult;
```

Run the focused test and expect PASS.

- [ ] **Step 4: Write failing regime and stop tests**

Assert BULLISH requires close above `currentCloudTop`, positive Kijun slope, and bullish projected cloud; BEARISH is the strict inverse; missing current cloud returns `INSUFFICIENT_DATA`; all other combinations return `NEUTRAL`. Assert LONG Kijun stops must be strictly below entry and SHORT stops strictly above entry.

- [ ] **Step 5: Run regime/stop tests and verify RED**

```bash
pnpm test packages/strategy-ichimoku/src/regime.test.ts packages/strategy-ichimoku/src/stop.test.ts
```

Expected: FAIL because regime and stop functions are missing.

- [ ] **Step 6: Implement regime and stop and verify GREEN**

Export:

```ts
type MarketRegime = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INSUFFICIENT_DATA';
function evaluateH4Regime(candle: Candle, point: IchimokuPoint): MarketRegime;

type StopProposal =
  | { status: 'VALID'; price: DecimalString }
  | { status: 'INVALID_INITIAL_STOP' };
function proposeKijunStop(
  direction: 'LONG' | 'SHORT',
  kijun: number | null,
  entryReference: DecimalString,
): StopProposal;
```

Run all three focused tests plus typecheck; expect PASS and exit 0.

- [ ] **Step 7: Commit strategy primitives**

```bash
git add packages/strategy-ichimoku
git commit -m "feat(strategy): evaluate breakout regime and stop"
```

### Task 6: Evaluate H1 candidates with structured reasons

**Files:**
- Create: `packages/strategy-ichimoku/src/candidate.ts`
- Modify: `packages/strategy-ichimoku/src/index.ts`
- Test: `packages/strategy-ichimoku/src/candidate.test.ts`

- [ ] **Step 1: Write failing candidate tests**

Use the public contract:

```ts
const result = evaluateH1Candidate({
  direction: 'LONG',
  regime: 'BULLISH',
  candles,
  index: candles.length - 1,
  indicator: points.at(-1)!,
  breakoutLookback: 20,
  decisionAt: asInstantString('2026-01-05T10:00:00Z'),
  trendCandleCloseTime: asInstantString('2026-01-05T08:00:00Z'),
  strategyVersion: '1.1.0-research',
});
```

Assert an approved LONG candidate only when the H4 regime, current Kumo, Kijun slope, and previous-window breakout agree. Assert rejected outcomes contain stable reason codes and insufficient history never throws.

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm test packages/strategy-ichimoku/src/candidate.test.ts
```

Expected: FAIL because `evaluateH1Candidate` is missing.

- [ ] **Step 3: Implement structured candidate evaluation**

Return a discriminated union with `status: 'APPROVED' | 'REJECTED'`, `direction`, decision and trend timestamps, strategy version, and a readonly reason-code array. Reuse `detectBreakout`; do not duplicate its window logic.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm test packages/strategy-ichimoku/src/candidate.test.ts
pnpm test packages/strategy-ichimoku
pnpm typecheck
```

Expected: candidate and all strategy tests pass.

- [ ] **Step 5: Commit candidate evaluation**

```bash
git add packages/strategy-ichimoku
git commit -m "feat(strategy): evaluate H1 candidates"
```

### Task 7: Prove causality against appended future data

**Files:**
- Create: `packages/strategy-ichimoku/src/causality.test.ts`

- [ ] **Step 1: Write the causality regression test**

Build at least 100 candles, choose a decision index `T`, and compute the full pipeline twice: once with data sliced through `T`, once with later candles appended. Compare the Ichimoku point, selected trend candle, breakout, regime, candidate result, and stop proposal at `T` for deep equality.

- [ ] **Step 2: Run and verify the test**

```bash
pnpm test packages/strategy-ichimoku/src/causality.test.ts
```

Expected: PASS. If it fails, treat the failure as evidence of future-data access, add the smallest focused failing regression test to the responsible package, then fix that package before continuing.

- [ ] **Step 3: Run the critical Kumo test separately**

```bash
pnpm test packages/indicators/src/ichimoku.test.ts -t "uses spans calculated displacement periods earlier"
```

Expected: PASS and proof that current cloud differs from the raw projected cloud in the synthetic dataset.

- [ ] **Step 4: Commit causality proof**

```bash
git add packages/strategy-ichimoku/src/causality.test.ts
git commit -m "test: prove strategy causality"
```

### Task 8: Run the complete quality gate and document the milestone

**Files:**
- Modify: `README.md`
- Create: `docs/milestones/core-research.md`

- [ ] **Step 1: Document package usage and exclusions**

Add root setup commands (`corepack enable`, `pnpm install`, `pnpm check`), the package map, and an explicit statement that no risk, backtest, UI, persistence, paper, or live execution exists yet. Document the completed invariants and link to the design and specifications.

- [ ] **Step 2: Run formatting and inspect changes**

```bash
pnpm format
git diff --check
git status --short
```

Expected: no whitespace errors and only intended milestone files modified.

- [ ] **Step 3: Run the full verification gate**

```bash
pnpm check
pnpm test:coverage
```

Expected: formatting, lint, strict typecheck, all tests, build, and coverage exit 0 with no warnings or failures.

- [ ] **Step 4: Verify forbidden scope is absent**

```bash
rg -n "next|prisma|redis|broker|placeOrder|ALLOW_LIVE_TRADING" packages package.json
```

Expected: no production implementation of UI, persistence, queues, brokers, or live execution. Documentation/type reason strings are acceptable only when clearly non-executable.

- [ ] **Step 5: Commit milestone documentation**

```bash
git add README.md docs packages package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.mjs prettier.config.mjs vitest.config.ts
git commit -m "docs: record core research milestone"
```

- [ ] **Step 6: Verify clean branch state**

```bash
git status -sb
git log --oneline --decorate -8
```

Expected: clean `agent/core-research` worktree with the design, scaffold, domain, temporal, indicators, strategy, causality, and documentation commits.
