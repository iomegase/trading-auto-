# Futures Risk Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 2A: validated dated-futures contracts and a pure, exact-decimal Risk Engine that sizes FDXS/MES research orders under causal FX, margin, cost, exposure, and portfolio constraints.

**Architecture:** Extend `@trading-auto/domain` with broker-neutral futures product and contract values, then add a new leaf package, `@trading-auto/risk`. The Risk Engine consumes immutable domain values and causally selected operational snapshots, computes asymmetric sizing equity and per-quantity economics, and returns an immutable `APPROVE`, `REDUCE_SIZE`, or `REJECT` result. Execution simulation and backtesting remain outside this plan.

**Tech Stack:** Node.js `>=22.15.0`, pnpm 10, strict TypeScript 7, Vitest 4, `decimal.js` 10.6, `@js-temporal/polyfill` 0.5, ESLint 10, Prettier 3.

**Design source:** `docs/superpowers/specs/2026-08-10-futures-risk-execution-backtest-design.md`

---

## Scope and dependency boundary

Milestone 2A creates one new production package:

```text
@trading-auto/domain
  <- @trading-auto/risk
```

`@trading-auto/risk` must not import calendars, indicators, strategy, execution,
or backtester code. It receives an already-approved setup, validated dated
contract, portfolio state, and causal snapshot bundle.

The implementation must not add:

- an execution simulator;
- a backtest clock or ledger;
- a broker adapter;
- live or paper order submission;
- real margin or commission claims;
- minute/tick data;
- automatic roll logic;
- automatic increases to `maxSizingCapital`.

## File map

### Existing files to modify

- `README.md`: add the Risk Engine package and research-only status.
- `package.json`: workspace-level scripts remain unchanged.
- `tsconfig.json`: add the risk package project reference.
- `tsconfig.test.json`: add the risk source alias.
- `vitest.config.ts`: add the risk source alias.
- `pnpm-lock.yaml`: record the risk workspace package.
- `packages/domain/src/errors.ts`: add stable futures validation codes.
- `packages/domain/src/index.ts`: export currency and futures contracts.
- `packages/test-helpers/src/index.ts`: export synthetic futures fixtures.
- `specs/*.md` and `specs/23-STRATEGY-CONFIG.example.json`: synchronize the approved capital-policy correction.
- `docs/superpowers/specs/2026-08-10-futures-risk-execution-backtest-design.md`: retain approved status.

### New domain and fixture files

- `packages/domain/src/currency.ts`: canonical ISO-style currency codes.
- `packages/domain/src/currency.test.ts`: currency runtime-boundary tests.
- `packages/domain/src/futures.ts`: immutable futures product and dated-contract factories.
- `packages/domain/src/futures.test.ts`: futures invariant tests.
- `packages/test-helpers/src/futures.ts`: deterministic synthetic FDXS and MES values.
- `docs/milestones/futures-risk.md`: delivered Milestone 2A contract and verification record.

### New risk package files

- `packages/risk/package.json`: package manifest.
- `packages/risk/tsconfig.json`: strict composite build configuration.
- `packages/risk/src/index.ts`: public exports only.
- `packages/risk/src/errors.ts`: typed programmer/input errors.
- `packages/risk/src/decimal.ts`: module-private isolated Decimal constructor.
- `packages/risk/src/snapshots.ts`: FX, margin, eligibility, fee/cost snapshots and causal selectors.
- `packages/risk/src/snapshots.test.ts`: snapshot factories, density, ordering, and selection tests.
- `packages/risk/src/policy.ts`: immutable risk policy factory and validation.
- `packages/risk/src/policy.test.ts`: policy boundary tests.
- `packages/risk/src/portfolio.ts`: immutable account, position, intent, and portfolio factories.
- `packages/risk/src/portfolio.test.ts`: portfolio validation and immutability tests.
- `packages/risk/src/equity.ts`: asymmetric sizing-equity calculation.
- `packages/risk/src/equity.test.ts`: loss, gain, zero, and cap tests.
- `packages/risk/src/economics.ts`: FX, fee tiers, stop loss, margin, cost, and notional calculations.
- `packages/risk/src/economics.test.ts`: exact FDXS/MES economics tests.
- `packages/risk/src/evaluate.ts`: finite grid search, guards, and public risk decision.
- `packages/risk/src/evaluate.test.ts`: all result branches and reason precedence.
- `packages/risk/src/causality.test.ts`: future-snapshot append invariance.
- `packages/risk/test-helpers/builders.ts`: risk-only test builders, excluded from production builds.

## Public contracts fixed by this plan

The implementation may refine private helpers but must preserve these public
names:

```ts
// @trading-auto/domain
asCurrencyCode
createFuturesProduct
createFuturesContract
CurrencyCode
FuturesProduct
FuturesContract

// @trading-auto/risk
createFxSnapshot
createMarginSnapshot
createEligibilitySnapshot
createCostModelSnapshot
selectRiskSnapshotBundle
createRiskPolicy
assertRiskPolicyDenormalizationMatches
assertM2ARiskSafetyAssertions
createRiskAccountState
createRiskPortfolioState
calculateSizingEquity
evaluateOrderRisk
RiskInputError
RiskDecision
RiskDecisionReason
RiskDecisionContext
RiskPolicyUseMode
M2ARiskSafetyAssertions
```

---

### Task 1: Synchronize the approved capital and futures-risk specifications

**Files:**

- Modify: `README.md`
- Modify: `specs/00-README.md`
- Modify: `specs/01-PRODUCT-SPEC.md`
- Modify: `specs/02-FUNCTIONAL-SPEC.md`
- Modify: `specs/04-DOMAIN-MODEL.md`
- Modify: `specs/10-STOP-EXIT-SPEC.md`
- Modify: `specs/11-RISK-ENGINE-SPEC.md`
- Modify: `specs/12-BACKTEST-ENGINE-SPEC.md`
- Modify: `specs/13-EXECUTION-BROKER-SPEC.md`
- Modify: `specs/14-DATABASE-SCHEMA.md`
- Modify: `specs/15-API-CONTRACTS.md`
- Modify: `specs/16-UI-UX-SPEC.md`
- Modify: `specs/17-TEST-PLAN.md`
- Modify: `specs/18-OBSERVABILITY-SPEC.md`
- Modify: `specs/19-SECURITY-SAFETY-SPEC.md`
- Modify: `specs/20-VALIDATION-RESEARCH-SPEC.md`
- Modify: `specs/21-IMPLEMENTATION-ROADMAP.md`
- Modify: `specs/22-ACCEPTANCE-CRITERIA.md`
- Modify: `specs/23-STRATEGY-CONFIG.example.json`
- Modify: `specs/24-CODEX-PROMPT.md`
- Modify: `specs/25-DECISIONS.md`
- Modify: `specs/26-DEFINITION-OF-DONE.md`
- Modify: `specs/30-AUDIT-CORRECTIONS-V3.md`

- [ ] **Step 1: Replace ADR-011 and extend ADR-014 in the authoritative decisions**

Replace the `ADR-011` body in `specs/25-DECISIONS.md` with:

```text
## ADR-011 — Capital initial et plafond de sizing

initialCapital = 1 000 EUR
initialMaxSizingCapital = 1 000 EUR
cashInjection = FORBIDDEN

asymmetricEquity =
  realizedEquity + min(0, unrealizedPnl)

sizingEquity =
  min(max(0, asymmetricEquity), maxSizingCapital)

Les gains latents n'augmentent jamais le sizing. Les pertes latentes le réduisent
immédiatement. `maxSizingCapital` ne peut augmenter que par activation manuelle
d'une nouvelle `RiskPolicyVersion`; le solde broker, une stratégie ou un backtest
ne peuvent pas l'augmenter automatiquement.
```

Replace the `ADR-014` body with:

```text
## ADR-014 — Exposition et levier futures

Le notionnel brut reste mesuré indépendamment de la marge. Toute
`RiskPolicyVersion` futures fournit explicitement `maxGrossExposurePct` et
`maxMarginUsagePct`. Une politique absente ne reçoit aucune valeur par défaut et
ne peut approuver aucun ordre futures. Respecter la marge ne remplace jamais les
limites de risque au stop, coûts ou notionnel.
```

- [ ] **Step 2: Replace the shared capital-domain contract**

Replace `StrategyCapitalContext` in `specs/04-DOMAIN-MODEL.md` with:

```ts
type StrategyCapitalContext = {
  referenceCurrency: "EUR"
  accountCurrency: "EUR"
  initialCapitalAccountCcy: DecimalString
  maxSizingCapitalAccountCcy: DecimalString
  realizedEquityAccountCcy: DecimalString
  unrealizedPnlAccountCcy: DecimalString
  asymmetricEquityAccountCcy: DecimalString
  sizingEquityAccountCcy: DecimalString
  riskPolicyVersion: string
}
```

Document these invariants immediately below it:

```text
initialCapitalAccountCcy = 1000
maxSizingCapitalAccountCcy > 0
asymmetricEquityAccountCcy =
  realizedEquityAccountCcy + min(0, unrealizedPnlAccountCcy)
sizingEquityAccountCcy =
  min(max(0, asymmetricEquityAccountCcy), maxSizingCapitalAccountCcy)
```

- [ ] **Step 3: Update the strategy configuration example exactly**

Replace the `capital` object in `specs/23-STRATEGY-CONFIG.example.json` with:

```json
"capital": {
  "referenceCurrency": "EUR",
  "accountCurrency": "EUR",
  "backtestInitialCapital": 1000,
  "initialMaxSizingCapital": 1000,
  "allowCashInjection": false,
  "sizingEquityMode": "REALIZED_PLUS_UNREALIZED_LOSSES",
  "capIncreaseMode": "MANUAL_VERSIONED"
}
```

Add these fields at the beginning of the `risk` object and retain the existing
baseline percentages:

```json
"policyVersion": "RISK_FUTURES_V1_RESEARCH",
"maxContractsPerPosition": 4,
"futuresEligibility": "RESEARCH_ONLY",
"requireExplicitGrossExposureLimit": true,
```

`risk.policyVersion` serializes the canonical `RiskPolicyVersion.version`; it is
not a second policy identifier.

Add the complete baseline mirror:

```json
"riskGroupMaxExposurePct": {
  "EUROPE_EQUITY_INDEX": 100.0,
  "US_EQUITY_INDEX": 100.0
}
```

Remove `riskGroupLimitsEnabled`. The resolved `RiskPolicyVersion` is the sole
authority. Copies of initial/max capital, currencies, modes, risk
percentages/counts, gross/margin limits, and the risk-group map are validated
denormalizations for readability and backward contract compatibility. The
boundary parser must canonicalize each copy and reject any value unequal to the
resolved policy; mirrors have no precedence and cannot override it.

Classify these separately as fixed Milestone 2A engine safety assertions and
metadata, not `RiskPolicyVersion` mirrors:

```json
"futuresEligibility": "RESEARCH_ONLY",
"requireExplicitGrossExposureLimit": true,
"includeEstimatedExitCosts": true,
"rejectIfMinQuantityExceedsRiskBudget": true
```

The parser rejects any other value as `INVALID_CONFIG`. A forged mismatch at the
public Risk Engine boundary is `INVALID_RISK_INPUT`; these fields never override
policy values.

Move `researchEligibilityNote` out of `risk` into a top-level, non-governed
`research` metadata object while preserving the FDXS/MES expected-rejection note.

Keep `maxGrossExposurePct: 100.0` in this initial research policy. Document that
FDXS/MES are expected to reject under this value unless a separately reviewed
policy version changes it.

- [ ] **Step 4: Apply one canonical wording to every downstream specification**

In each remaining file listed for this task, replace permanent-cap claims with
the following complete policy statement or a direct link to `ADR-011` followed
by the same formulas:

```text
La baseline démarre avec `initialCapital = 1 000 EUR` et interdit toute injection
de cash. Le capital de sizing est l'equity réalisée diminuée immédiatement des
pertes latentes, sans inclure les gains latents, puis bornée par le
`maxSizingCapital` de la `RiskPolicyVersion` active. Le plafond initial vaut
`1 000 EUR`; toute augmentation est manuelle, auditée et versionnée.
```

Apply these schema/API renames wherever the old names occur:

```text
hard_capital_cap_eur       -> max_sizing_capital_account_ccy
initial_capital_reference  -> initial_capital_account_ccy
hardCapitalCapEur          -> maxSizingCapital
hardCapEur                 -> maxSizingCapital
effectiveCapitalAccountCcy -> sizingEquityAccountCcy
```

Preserve historical wording only inside an explicitly marked history paragraph
that links to ADR-011 and states that it is superseded.

- [ ] **Step 5: Add capital-policy acceptance checks**

Add these explicit checklist items to `specs/22-ACCEPTANCE-CRITERIA.md` and
`specs/26-DEFINITION-OF-DONE.md`:

Use French and preserve each target file's existing list style:

```text
- capital initial exactement `1 000 EUR`
- aucune injection de cash
- plafond initial de capital de sizing exactement `1 000 EUR`
- les pertes latentes réduisent immédiatement le capital de sizing
- les gains latents n'augmentent jamais le capital de sizing
- toute hausse du plafond exige une nouvelle version de politique de risque approuvée manuellement
- les limites d'exposition brute et de marge des futures sont toutes deux explicites
- une quantité nulle n'est jamais arrondie à un contrat
```

- [ ] **Step 6: Verify there is no unmarked authoritative contradiction**

Run:

```bash
rg -n "hardCapitalCap|hard_capital_cap|capital effectif.*<=.*1.?000|plafond absolu.*1.?000" README.md specs
```

Expected: no authoritative hit. Any historical hit must contain `superseded` or
`remplacé par ADR-011` in the same paragraph.

Run:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('specs/23-STRATEGY-CONFIG.example.json','utf8'))"
pnpm format:check
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 7: Commit the specification correction**

```bash
git add README.md specs
git commit -m "docs: adopt versioned sizing capital policy"
```

---

### Task 2: Scaffold the isolated Risk Engine package

**Files:**

- Create: `packages/risk/package.json`
- Create: `packages/risk/tsconfig.json`
- Create: `packages/risk/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.test.json`
- Modify: `vitest.config.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Create the package manifest**

Create `packages/risk/package.json`:

```json
{
  "name": "@trading-auto/risk",
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
    "decimal.js": "10.6.0"
  },
  "devDependencies": {
    "@trading-auto/test-helpers": "workspace:*"
  }
}
```

- [ ] **Step 2: Create the composite TypeScript configuration**

Create `packages/risk/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{ "path": "../domain" }]
}
```

Create `packages/risk/src/index.ts` as an empty module:

```ts
export {};
```

- [ ] **Step 3: Register the project and test aliases**

Add `{ "path": "./packages/risk" }` after the strategy project in
`tsconfig.json`.

Add this path to `tsconfig.test.json`:

```json
"@trading-auto/risk": ["./packages/risk/src/index.ts"]
```

Add this alias to `vitest.config.ts`:

```ts
'@trading-auto/risk': source('./packages/risk/src/index.ts'),
```

- [ ] **Step 4: Refresh the frozen workspace lock and verify the empty package**

Run:

```bash
pnpm install
pnpm format
pnpm check
```

Expected: lockfile contains `packages/risk`; all existing 304 tests pass; build
emits `packages/risk/dist/index.js` and `index.d.ts`.

- [ ] **Step 5: Commit the scaffold**

```bash
git add packages/risk tsconfig.json tsconfig.test.json vitest.config.ts pnpm-lock.yaml
git commit -m "build: scaffold futures risk package"
```

---

### Task 3: Add canonical currencies and dated futures contracts

**Files:**

- Create: `packages/domain/src/currency.ts`
- Create: `packages/domain/src/currency.test.ts`
- Create: `packages/domain/src/futures.ts`
- Create: `packages/domain/src/futures.test.ts`
- Modify: `packages/domain/src/errors.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write failing currency and futures boundary tests**

Create `packages/domain/src/currency.test.ts` with exactly these initial cases:

```ts
import { describe, expect, it } from 'vitest';

import { DomainValidationError } from './errors.js';
import { asCurrencyCode } from './currency.js';

describe('asCurrencyCode', () => {
  it('accepts canonical uppercase ISO-style codes', () => {
    expect(asCurrencyCode('EUR')).toBe('EUR');
    expect(asCurrencyCode('USD')).toBe('USD');
  });

  it.each(['eur', 'EU', 'EURO', ' EUR ', '', '12A'])('rejects %j', (value) => {
    expect(() => asCurrencyCode(value)).toThrow(DomainValidationError);
  });
});
```

Create `packages/domain/src/futures.test.ts`. Include one valid cash-settled
product and contract plus table tests that reject:

```text
blank productCode, exchange, underlyingId, riskGroup, contractId
non-positive tickSize, tickValue, monetaryValuePerPriceUnit
non-positive or fractional futures quantityStep/minQuantity
tickValue / tickSize different from monetaryValuePerPriceUnit
productCode mismatch
firstTradeAt >= lastTradeAt
lastTradeAt > expiryAt
unsupported settlementType
runtime non-object inputs
```

The valid product must use exact strings:

```ts
const product = createFuturesProduct({
  productCode: 'FDXS',
  exchange: 'XEUR',
  underlyingId: 'DAX',
  quoteCurrency: 'EUR',
  pnlCurrency: 'EUR',
  tickSize: '0.5',
  tickValue: '0.5',
  monetaryValuePerPriceUnit: '1',
  quantityStep: '1',
  minQuantity: '1',
  riskGroup: 'EUROPE_EQUITY_INDEX',
});
```

- [ ] **Step 2: Run the tests to establish RED**

Run:

```bash
pnpm test packages/domain/src/currency.test.ts packages/domain/src/futures.test.ts
```

Expected: both suites fail because `currency.js` and `futures.js` do not exist.

- [ ] **Step 3: Implement the currency and futures factories**

Create `currency.ts` with an uppercase-three-letter brand and a runtime factory.
Create `futures.ts` with these public interfaces and functions:

```ts
export type SettlementType = 'CASH' | 'PHYSICAL';

export interface FuturesProductInput {
  productCode: string;
  exchange: string;
  underlyingId: string;
  quoteCurrency: string;
  pnlCurrency: string;
  tickSize: string;
  tickValue: string;
  monetaryValuePerPriceUnit: string;
  quantityStep: string;
  minQuantity: string;
  riskGroup: string;
}

export interface FuturesProduct {
  readonly productCode: string;
  readonly exchange: string;
  readonly underlyingId: string;
  readonly quoteCurrency: CurrencyCode;
  readonly pnlCurrency: CurrencyCode;
  readonly tickSize: DecimalString;
  readonly tickValue: DecimalString;
  readonly monetaryValuePerPriceUnit: DecimalString;
  readonly quantityStep: DecimalString;
  readonly minQuantity: DecimalString;
  readonly riskGroup: string;
}

export interface FuturesContractInput {
  contractId: string;
  productCode: string;
  firstTradeAt: string;
  lastTradeAt: string;
  expiryAt: string;
  settlementType: SettlementType;
}

export interface FuturesContract {
  readonly contractId: string;
  readonly productCode: string;
  readonly firstTradeAt: InstantString;
  readonly lastTradeAt: InstantString;
  readonly expiryAt: InstantString;
  readonly settlementType: SettlementType;
}

export function createFuturesProduct(
  input: FuturesProductInput,
): Readonly<FuturesProduct>;

export function createFuturesContract(
  input: FuturesContractInput,
  product: Readonly<FuturesProduct>,
): Readonly<FuturesContract>;
```

Import `asDecimalString`, `decimalFrom`, and `DecimalString` directly from
`./decimal.js`; keep `decimalFrom` absent from the package barrel. Require exact
tick coherence:

```text
tickValue / tickSize == monetaryValuePerPriceUnit
```

Require integer `quantityStep` and `minQuantity`, and require
`minQuantity % quantityStep == 0`. Canonicalize instants through
`asInstantString` and freeze returned records.

Add these codes to `DomainValidationErrorCode`:

```ts
| 'INVALID_CURRENCY'
| 'INVALID_FUTURES_PRODUCT'
| 'INVALID_FUTURES_CONTRACT'
```

Export the new values from `packages/domain/src/index.ts`.

- [ ] **Step 4: Run focused GREEN and the domain suite**

Run:

```bash
pnpm test packages/domain/src/currency.test.ts packages/domain/src/futures.test.ts
pnpm test packages/domain
pnpm typecheck
```

Expected: focused suites and the full domain suite pass; TypeScript reports no
error.

- [ ] **Step 5: Commit the domain contracts**

```bash
git add packages/domain/src
git commit -m "feat(domain): validate dated futures contracts"
```

---

### Task 4: Add immutable operational snapshots and causal selection

**Files:**

- Create: `packages/risk/src/errors.ts`
- Create: `packages/risk/src/decimal.ts`
- Create: `packages/risk/src/snapshots.ts`
- Create: `packages/risk/src/snapshots.test.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write failing snapshot factory tests**

Create `packages/risk/src/snapshots.test.ts`. Define valid EUR/USD FX plus MES
margin, eligibility, and cost inputs and assert that factories:

```text
canonicalize all instants and decimals
deep-freeze nested fee tiers
reject blank version/source/contract identifiers
reject `validFrom >= validUntil` while treating `observedAt` as an independent
publication instant
reject non-positive FX and margin values
allow an explicitly complete zero-cost model
reject negative fee, spread, or slippage values
reject unsorted fee tiers or a tier list without a final open-ended tier
reject sparse snapshot and tier arrays
reject runtime non-object inputs
```

Include this causal selection test:

```ts
it('ignores snapshots observed after the decision', () => {
  const selected = selectRiskSnapshotBundle(
    {
      fx: [fxAt0800, fxAt1000],
      margin: [marginAt0800, marginAt1000],
      eligibility: [eligibilityAt0800, eligibilityAt1000],
      costs: [costsAt0800, costsAt1000],
    },
    {
      decisionAt: asInstantString('2026-01-02T09:00:00Z'),
      contractId: 'MESH26',
      pnlCurrency: asCurrencyCode('USD'),
      accountCurrency: asCurrencyCode('EUR'),
    },
  );

  expect(selected.fx?.observedAt).toBe('2026-01-02T08:00:00Z');
  expect(selected.margin?.observedAt).toBe('2026-01-02T08:00:00Z');
});
```

- [ ] **Step 2: Run the snapshot suite to establish RED**

Run:

```bash
pnpm test packages/risk/src/snapshots.test.ts
```

Expected: FAIL because the snapshot exports are absent.

- [ ] **Step 3: Implement exact snapshot contracts**

Create a module-private `RiskDecimal = Decimal.clone({ maxE: 9e15, minE: -9e15 })`.
Do not export it.

Define and factory-validate these contracts in `snapshots.ts`:

```ts
export interface SnapshotMetadata {
  readonly version: string;
  readonly source: string;
  readonly observedAt: InstantString;
  readonly validFrom: InstantString;
  readonly validUntil: InstantString;
}

export interface FxSnapshot extends SnapshotMetadata {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly rate: DecimalString;
}

export interface MarginSnapshot extends SnapshotMetadata {
  readonly contractId: string;
  readonly currency: CurrencyCode;
  readonly initialMarginPerContract: DecimalString;
  readonly maintenanceMarginPerContract: DecimalString;
}

export interface EligibilitySnapshot extends SnapshotMetadata {
  readonly contractId: string;
  readonly researchOnly: boolean;
  readonly eligible: boolean;
  readonly reason: string | null;
}

export interface FeeTier {
  readonly upToQuantity: DecimalString | null;
  readonly feePerContract: DecimalString;
}

export interface FeeSchedule {
  readonly minimum: DecimalString;
  readonly tiers: readonly Readonly<FeeTier>[];
}

export interface CostModelSnapshot extends SnapshotMetadata {
  readonly contractId: string;
  readonly currency: CurrencyCode;
  readonly entryFees: Readonly<FeeSchedule>;
  readonly exitFees: Readonly<FeeSchedule>;
  readonly spreadPriceUnitsRoundTrip: DecimalString;
  readonly adverseEntrySlippagePriceUnits: DecimalString;
  readonly adverseExitSlippagePriceUnits: DecimalString;
}
```

`selectRiskSnapshotBundle` must validate dense arrays, select only snapshots with
`observedAt <= decisionAt`, match contract/currency identifiers, and choose the
greatest actual `observedAt` using `Temporal.Instant.compare`, never lexical or
array order. Selection deliberately retains the latest observed snapshot even
when its validity interval has expired so the evaluator can distinguish
`STALE_*` from `MISSING_*`.

An identity FX conversion returns no FX snapshot and is represented by `fx: null`.
Do not synthesize a `1` FX record.

The selector returns this immutable shape; a nullable field means no matching
snapshot was observable at `decisionAt`:

```ts
export interface RiskSnapshotBundle {
  readonly fx: Readonly<FxSnapshot> | null;
  readonly margin: Readonly<MarginSnapshot> | null;
  readonly eligibility: Readonly<EligibilitySnapshot> | null;
  readonly costs: Readonly<CostModelSnapshot> | null;
}
```

For Milestone 2A, margin and cost snapshot currencies must equal the product P&L
currency. Reject any other non-account currency as `MISMATCHED_CURRENCY`;
multi-leg currency conversion is deferred rather than approximated.

Create `RiskInputError` with stable codes:

```ts
export type RiskInputErrorCode =
  | 'INVALID_RISK_INPUT'
  | 'INVALID_SNAPSHOT'
  | 'LOOKAHEAD_SNAPSHOT'
  | 'MISMATCHED_CONTRACT'
  | 'MISMATCHED_CURRENCY'
  | 'STALE_COST_MODEL'
  | 'GRID_TOO_LARGE';
```

- [ ] **Step 4: Run snapshot GREEN, lint, and typecheck**

Run:

```bash
pnpm test packages/risk/src/snapshots.test.ts
pnpm lint
pnpm typecheck
```

Expected: all exit `0`.

- [ ] **Step 5: Commit operational snapshot support**

```bash
git add packages/risk/src
git commit -m "feat(risk): validate causal operational snapshots"
```

---

### Task 5: Add risk policy, portfolio state, and asymmetric sizing equity

**Files:**

- Create: `packages/risk/src/policy.ts`
- Create: `packages/risk/src/policy.test.ts`
- Create: `packages/risk/src/portfolio.ts`
- Create: `packages/risk/src/portfolio.test.ts`
- Create: `packages/risk/src/equity.ts`
- Create: `packages/risk/src/equity.test.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write failing risk-policy and equity tests**

Create tests that require the exact baseline:

```ts
const policyInput = {
  version: 'RISK_FUTURES_V1_RESEARCH',
  approvalStatus: 'APPROVED',
  referenceCurrency: 'EUR',
  accountCurrency: 'EUR',
  initialCapital: '1000',
  maxSizingCapital: '1000',
  riskPerTradePct: '0.5',
  maxOpenRiskPct: '2',
  maxOpenPositions: 4,
  maxContractsPerPosition: '4',
  maxGrossExposurePct: '100',
  maxMarginUsagePct: '100',
  cashReservePct: '0',
  dailyLossLimitPct: '2',
  maxDrawdownPct: '10',
  riskGroupMaxExposurePct: {
    EUROPE_EQUITY_INDEX: '100',
    US_EQUITY_INDEX: '100',
  },
  allowCashInjection: false,
  sizingEquityMode: 'REALIZED_PLUS_UNREALIZED_LOSSES',
  capIncreaseMode: 'MANUAL_VERSIONED',
  approvedBy: 'RESEARCH_RISK_OWNER',
  approvedAt: '2026-01-01T00:00:00Z',
  activatedAt: '2026-01-01T00:00:00Z',
} as const;

const policy = createRiskPolicy(policyInput);
```

Test that factories reject noncanonical decimals, values outside `0..100` where
appropriate, `initialCapital` values `900`, `1000.01`, or malformed values,
non-integer counts, `allowCashInjection: true`, unsupported modes, a runtime
input cast with `DRAFT` or another unsupported approval status, a blank
`approvedBy`, noncanonical approval/activation instants,
`approvedAt > activatedAt`, `accountCurrency` different from
`referenceCurrency` or currencies other than `EUR`, blank or duplicate risk
groups, sparse positions/intents, duplicate position identifiers, and
contradictory account totals. The runtime `RiskPolicyVersion` output type itself
must expose only `approvalStatus: 'APPROVED'`.

Add table tests for `assertRiskPolicyDenormalizationMatches`. After boundary
canonicalization, every retained policy mirror from the API and strategy
configuration must equal the resolved policy. Cover initial/max capital,
currencies, modes, risk percentages/counts, gross/margin limits, and the nested
risk-group map. Change each mirrored field in turn and require a typed input
error. Exact mirrors pass. There is no override or precedence branch.

Separately test `assertM2ARiskSafetyAssertions` with the four exact constants:
`RESEARCH_ONLY`, `true`, `true`, `true`. Mutate each field in turn and require
`INVALID_RISK_INPUT`; never treat one of these failures as a policy-mirror
mismatch. Document that the configuration adapter maps the same mismatch to
`INVALID_CONFIG` before constructing `OrderRiskInput`.

Add exact asymmetric-equity assertions:

```ts
expect(calculateSizingEquity(account('1000', '200'), policy)).toBe('1000');
expect(calculateSizingEquity(account('1000', '-200'), policy)).toBe('800');
expect(calculateSizingEquity(account('1300', '0'), policy)).toBe('1000');
expect(
  calculateSizingEquity(
    account('1300', '0'),
    createRiskPolicy({
      ...policyInput,
      version: 'RISK_CAP_1200',
      maxSizingCapital: '1200',
    }),
  ),
).toBe('1200');
expect(
  calculateSizingEquity(
    account('1000', '0'),
    createRiskPolicy({
      ...policyInput,
      version: 'RISK_CAP_800',
      maxSizingCapital: '800',
    }),
  ),
).toBe('800');
```

- [ ] **Step 2: Run the policy/equity suites to establish RED**

Run:

```bash
pnpm test packages/risk/src/policy.test.ts packages/risk/src/portfolio.test.ts packages/risk/src/equity.test.ts
```

Expected: FAIL because the policy, portfolio, and equity modules are absent.

- [ ] **Step 3: Implement immutable policy and portfolio contracts**

Implement immutable `RiskPolicyVersion` with the fields shown in Step 1;
`createRiskPolicy` returns that contract. Percentages must be
canonical, non-negative, and bounded by `100`, except
`maxGrossExposurePct`, which must be strictly positive and may exceed `100` for
an explicitly versioned futures policy.

The factory accepts only `approvalStatus: 'APPROVED'`, requires exactly the
canonical decimal `initialCapital: '1000'`, requires a nonblank
`approvedBy`, canonical `approvedAt` and `activatedAt` instants, and
`approvedAt <= activatedAt`. Milestone 2A also requires
`referenceCurrency = accountCurrency = EUR`; it rejects every other account or
reference currency and performs no FX conversion of capital-policy limits.
`maxSizingCapital` must be strictly positive but may be lower or higher than
`initialCapital` in a later manually approved version.

Implement `assertRiskPolicyDenormalizationMatches` as the shared ingress guard for
API/config adapters. It validates every supplied governed mirror after canonical
parsing against the already resolved `RiskPolicyVersion`, requires the complete
risk-group map wherever that mirror is present, throws `RiskInputError` on any
mismatch, and never merges or overrides policy fields. Export it from the package
barrel.

Implement and export immutable `M2ARiskSafetyAssertions` plus
`assertM2ARiskSafetyAssertions`. The latter accepts only
`futuresEligibility: 'RESEARCH_ONLY'` and the three required `true` flags. It
throws `RiskInputError('INVALID_RISK_INPUT')` at the public risk boundary and does
not read or modify `RiskPolicyVersion`.

Implement these account and portfolio shapes:

```ts
export interface RiskAccountState {
  readonly accountCurrency: CurrencyCode;
  readonly realizedEquity: DecimalString;
  readonly unrealizedPnl: DecimalString;
  readonly availableFunds: DecimalString;
  readonly usedMargin: DecimalString;
  readonly grossExposure: DecimalString;
  readonly openRisk: DecimalString;
  readonly dailyLoss: DecimalString;
  readonly drawdownPct: DecimalString;
  readonly killSwitchActive: boolean;
}

export interface RiskPosition {
  readonly positionId: string;
  readonly instrumentId: string;
  readonly contractId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly quantity: DecimalString;
  readonly remainingOpenRisk: DecimalString;
  readonly margin: DecimalString;
  readonly grossExposure: DecimalString;
  readonly riskGroup: string;
}

export interface ActiveEntryIntent {
  readonly intentId: string;
  readonly instrumentId: string;
  readonly contractId: string;
  readonly direction: 'LONG' | 'SHORT';
}

export interface RiskPortfolioState {
  readonly positions: readonly Readonly<RiskPosition>[];
  readonly activeEntryIntents: readonly Readonly<ActiveEntryIntent>[];
}
```

Factories must perform full runtime validation and return deeply frozen values.

- [ ] **Step 4: Implement exact asymmetric equity**

Implement only this formula using the module-private risk Decimal clone:

```text
asymmetric = realizedEquity + min(0, unrealizedPnl)
nonNegative = max(0, asymmetric)
sizingEquity = min(nonNegative, maxSizingCapital)
```

Return a canonical non-exponential `DecimalString`. Do not mutate policy or
account inputs.

- [ ] **Step 5: Run focused GREEN and full risk package tests**

Run:

```bash
pnpm test packages/risk/src/policy.test.ts packages/risk/src/portfolio.test.ts packages/risk/src/equity.test.ts
pnpm test packages/risk
pnpm typecheck
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit capital and portfolio contracts**

```bash
git add packages/risk/src
git commit -m "feat(risk): model versioned sizing capital"
```

---

### Task 6: Calculate exact futures economics

**Files:**

- Create: `packages/risk/src/economics.ts`
- Create: `packages/risk/src/economics.test.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write failing FDXS and MES economics tests**

Add exact tests for:

```text
identity EUR conversion
direct USD/EUR conversion
inverse EUR/USD conversion
entry and stop tick alignment
stop distance and per-contract loss
tiered fees with a minimum per side
spread and adverse entry/exit slippage
initial and maintenance margin conversion
gross notional conversion
round-trip costs in a currency different from account currency
ambient Decimal.set contamination
```

Use these exact simple assertions independent of live market parameters:

```ts
it('calculates a synthetic FDXS contract exactly', () => {
  const result = calculateCandidateEconomics({
    direction: 'LONG',
    entryPrice: asDecimalString('100'),
    stopPrice: asDecimalString('98'),
    quantity: asDecimalString('2'),
    product: syntheticFdxsProduct,
    accountCurrency: asCurrencyCode('EUR'),
    fx: null,
    margin: syntheticEurMargin,
    costs: syntheticEurCosts,
  });

  expect(result.directionalLossAccount).toBe('4');
  expect(result.grossExposureAccount).toBe('200');
});
```

For MES, use a synthetic direct conversion of `1 USD = 0.8 EUR`, entry `100`,
stop `99`, one contract, and assert directional loss `4 EUR` when the product's
monetary value is `5 USD` per price unit.

- [ ] **Step 2: Run the economics suite to establish RED**

Run:

```bash
pnpm test packages/risk/src/economics.test.ts
```

Expected: FAIL because `calculateCandidateEconomics` is absent.

- [ ] **Step 3: Implement direct/inverse FX and tiered fee calculation**

Implement:

```ts
export function resolveFxRate(
  from: CurrencyCode,
  to: CurrencyCode,
  snapshot: Readonly<FxSnapshot> | null,
): DecimalString;

export function calculateFee(
  quantity: DecimalString,
  schedule: Readonly<FeeSchedule>,
): DecimalString;
```

Identity currency returns `1`. Direct conversion uses `rate`; inverse conversion
uses `1 / rate` with sufficient local Decimal precision and canonical output.
Reject an unrelated pair.

Fee tiers are marginal, ordered, and exhaustive. Sum the tier charges and apply
`max(calculatedFee, minimum)` independently to entry and exit.

- [ ] **Step 4: Implement candidate economics**

Expose:

```ts
export interface CandidateEconomics {
  readonly quantity: DecimalString;
  readonly directionalLossAccount: DecimalString;
  readonly estimatedCostsAccount: DecimalString;
  readonly worstCaseBudgetedLossAccount: DecimalString;
  readonly initialMarginAccount: DecimalString;
  readonly maintenanceMarginAccount: DecimalString;
  readonly grossExposureAccount: DecimalString;
}
```

Use exact formulas:

```text
directionalLossPnl =
  abs(entryPrice - stopPrice)
  * monetaryValuePerPriceUnit
  * quantity

spreadAndSlippagePnl =
  (spreadPriceUnitsRoundTrip
   + adverseEntrySlippagePriceUnits
   + adverseExitSlippagePriceUnits)
  * monetaryValuePerPriceUnit
  * quantity

worstCaseBudgetedLossAccount =
  convert(directionalLossPnl + spreadAndSlippagePnl)
  + convert(entryFees + exitFees)

grossExposureAccount =
  convert(abs(entryPrice) * monetaryValuePerPriceUnit * quantity)
```

Require entry and stop to be positive, finite, and aligned exactly to
`product.tickSize`. Require the stop strictly below LONG entry and strictly above
SHORT entry.

- [ ] **Step 5: Run focused GREEN, contamination test, and typecheck**

Run:

```bash
pnpm test packages/risk/src/economics.test.ts
pnpm typecheck
```

Expected: tests pass before and after a test temporarily mutates global
`Decimal` exponent/precision settings and restores them in `finally`.

- [ ] **Step 6: Commit futures economics**

```bash
git add packages/risk/src
git commit -m "feat(risk): calculate exact futures economics"
```

---

### Task 7: Implement finite quantity search and risk decisions

**Files:**

- Create: `packages/risk/src/evaluate.ts`
- Create: `packages/risk/src/evaluate.test.ts`
- Create: `packages/risk/test-helpers/builders.ts`
- Modify: `packages/risk/src/index.ts`

- [ ] **Step 1: Write failing result-branch and precedence tests**

Create builders that always use explicit synthetic values. Do not read the clock
or environment variables.

The evaluator input must contain:

```ts
export interface OrderRiskInput {
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly requestedQuantity?: DecimalString;
  readonly decisionAt: InstantString;
  readonly riskPolicyUseMode: RiskPolicyUseMode;
  readonly riskPolicyUseAt: InstantString;
  readonly backtestId?: string;
  readonly runCreatedAt?: InstantString;
  readonly signalExpiresAt: InstantString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
  readonly product: Readonly<FuturesProduct>;
  readonly contract: Readonly<FuturesContract>;
  readonly snapshots: Readonly<RiskSnapshotBundle>;
  readonly policy: Readonly<RiskPolicyVersion>;
  readonly safetyAssertions: Readonly<M2ARiskSafetyAssertions>;
  readonly account: Readonly<RiskAccountState>;
  readonly portfolio: Readonly<RiskPortfolioState>;
}
```

Write at least one focused test for each result:

```ts
expect(evaluateOrderRisk(approvableInput())).toMatchObject({
  status: 'APPROVE',
  quantity: '1',
  reasons: [],
});

expect(
  evaluateOrderRisk(approvableInput({ requestedQuantity: '4' })),
).toMatchObject({
  status: 'REDUCE_SIZE',
  requestedQuantity: '4',
  quantity: '1',
});

expect(evaluateOrderRisk(inputWithNoFeasibleContract())).toMatchObject({
  status: 'REJECT',
  quantity: '0',
  reasons: ['RISK_BUDGET'],
});

expect(
  evaluateOrderRisk(
    inputFeasibleThroughFour({
      requestedQuantity: '5',
      policy: policy({ maxContractsPerPosition: '4' }),
    }),
  ),
).toMatchObject({
  status: 'REDUCE_SIZE',
  requestedQuantity: '5',
  quantity: '4',
  reasons: ['MAX_CONTRACTS_PER_POSITION'],
});
```

Add table tests for stable reasons and deterministic precedence:

```text
KILL_SWITCH
SIGNAL_EXPIRED
POSITION_ALREADY_ACTIVE
ENTRY_INTENT_ALREADY_ACTIVE
MAX_POSITIONS
MAX_CONTRACTS_PER_POSITION
DAILY_LOSS_LIMIT
DRAWDOWN_LIMIT
NO_SIZING_EQUITY
MISSING_FX
STALE_FX
MISSING_MARGIN
STALE_MARGIN
MISSING_ELIGIBILITY
STALE_ELIGIBILITY
INELIGIBLE_CONTRACT
RISK_BUDGET
OPEN_RISK
MARGIN
GROSS_EXPOSURE
RISK_GROUP_EXPOSURE
AVAILABLE_FUNDS
MIN_QUANTITY
```

Malformed records, future-observed snapshots, mismatched contracts/currencies,
stale costs, incomplete risk-group policies, and an excessive grid size must
throw `RiskInputError` before any business result is returned.

Add focused input-boundary tests for both policy-use modes:

```text
approvedAt <= activatedAt <= riskPolicyUseAt in every mode
FORWARD requires riskPolicyUseAt === decisionAt and rejects any mismatch
FORWARD rejects backtestId and runCreatedAt
HISTORICAL_RESEARCH requires a nonblank backtestId and
  riskPolicyUseAt === runCreatedAt
HISTORICAL_RESEARCH permits decisionAt < activatedAt when runCreatedAt is later
activatedAt > riskPolicyUseAt rejects before business evaluation in both modes
```

- [ ] **Step 2: Run the evaluator suite to establish RED**

Run:

```bash
pnpm test packages/risk/src/evaluate.test.ts
```

Expected: FAIL because `evaluateOrderRisk` is absent.

- [ ] **Step 3: Define immutable result contracts**

Define:

```ts
export type RiskDecisionReason =
  | 'KILL_SWITCH'
  | 'SIGNAL_EXPIRED'
  | 'POSITION_ALREADY_ACTIVE'
  | 'ENTRY_INTENT_ALREADY_ACTIVE'
  | 'MAX_POSITIONS'
  | 'MAX_CONTRACTS_PER_POSITION'
  | 'DAILY_LOSS_LIMIT'
  | 'DRAWDOWN_LIMIT'
  | 'NO_SIZING_EQUITY'
  | 'MISSING_FX'
  | 'STALE_FX'
  | 'MISSING_MARGIN'
  | 'STALE_MARGIN'
  | 'MISSING_ELIGIBILITY'
  | 'STALE_ELIGIBILITY'
  | 'INELIGIBLE_CONTRACT'
  | 'RISK_BUDGET'
  | 'OPEN_RISK'
  | 'MARGIN'
  | 'GROSS_EXPOSURE'
  | 'RISK_GROUP_EXPOSURE'
  | 'AVAILABLE_FUNDS'
  | 'MIN_QUANTITY';

export type RiskDecision =
  | Readonly<{
      status: 'APPROVE';
      quantity: DecimalString;
      reasons: readonly [];
      economics: Readonly<CandidateEconomics>;
      context: Readonly<RiskDecisionContext>;
    }>
  | Readonly<{
      status: 'REDUCE_SIZE';
      requestedQuantity: DecimalString;
      quantity: DecimalString;
      reasons: readonly RiskDecisionReason[];
      economics: Readonly<CandidateEconomics>;
      context: Readonly<RiskDecisionContext>;
    }>
  | Readonly<{
      status: 'REJECT';
      quantity: DecimalString;
      reasons: readonly RiskDecisionReason[];
      economics: Readonly<CandidateEconomics> | null;
      context: Readonly<RiskDecisionContext>;
    }>;
```

`RiskDecisionReason` is shared by `REDUCE_SIZE` and `REJECT`; it is not a
rejection-only type. `APPROVE` always has an empty reason tuple. `REDUCE_SIZE`
contains the ordered constraints that prevented the requested quantity, while
`REJECT` contains the ordered constraints that prevented every feasible grid
quantity. The same stable code, including `MAX_CONTRACTS_PER_POSITION`, may
therefore be counted separately under reduction and rejection statuses.

Define `RiskPolicyUseMode = 'HISTORICAL_RESEARCH' | 'FORWARD'`. Define
`RiskDecisionContext` with `decisionAt`, `riskPolicyUseMode`, `riskPolicyUseAt`,
nullable `backtestId`, nullable `runCreatedAt`, `signalExpiresAt`, `entryPrice`,
`stopPrice`, `datasetVersion`, `strategyVersion`, `riskPolicyVersion`, nullable
`fxVersion`, nullable `marginVersion`, `costModelVersion`, nullable
`eligibilityVersion`, `productCode`, and `contractId`. Snapshot fields are null
only when the corresponding operational input was not observable or the FX
conversion is identity. A reject that occurs before economics can be computed
returns `economics: null`; a reject based on the evaluated minimum quantity
records that immutable economics object. Deep-freeze results, context, economics,
and reason arrays.

- [ ] **Step 4: Implement guard ordering and snapshot validity**

Use the reason order from Step 1 exactly. Throw for programmer/input violations.
Return a rejection for expected operational constraints.

Cost coverage is strict: absent or expired cost input throws
`RiskInputError('STALE_COST_MODEL')`; the later backtester will map that error to
`INVALID_DATA`. Missing or stale candidate FX/margin/eligibility returns stable
rejection reasons.

Validate every selected snapshot again at the public evaluator boundary. A
snapshot with `observedAt > decisionAt`, a wrong contract, an unrelated FX pair,
or a margin/cost currency different from `product.pnlCurrency` is a typed input
error. A selected snapshot is current only when
`validFrom <= decisionAt < validUntil`; boundary equality at `validUntil` is
stale.

Validate the policy timeline at the same boundary. Evaluation is permitted only
when `policy.approvalStatus === 'APPROVED'` and
`policy.approvedAt <= policy.activatedAt <= riskPolicyUseAt`. In `FORWARD`, require
`riskPolicyUseAt === decisionAt` and reject supplied `backtestId` or
`runCreatedAt`. In `HISTORICAL_RESEARCH`, require a nonblank `backtestId`,
canonical `runCreatedAt`, and `riskPolicyUseAt === runCreatedAt`; `decisionAt` may
be earlier. Validate `safetyAssertions` independently from policy mirrors. A
future policy relative to `riskPolicyUseAt`, a mode/use-time mismatch, a missing
historical run link, a fixed-assertion mismatch, or a runtime object cast with
`DRAFT` is a typed input error, never a business rejection.

Milestone 2A does not create or query backtest records. It preserves the validated
`backtestId` and `runCreatedAt` in `RiskDecisionContext`; Milestone 2C persistence
must enforce the FK and
`riskPolicyUseAt === referencedBacktest.createdAt`. `FORWARD` decisions persist a
null `backtestId`.

- [ ] **Step 5: Implement bounded grid search**

Compute candidate quantities from `minQuantity` through
`maxContractsPerPosition` on the exact `quantityStep` grid. Before iterating,
compute the number of candidates and throw `GRID_TOO_LARGE` if it exceeds the
module safety constant `MAX_GRID_ITERATIONS = 10000`. This operational bound is
not part of the governed `RiskPolicyVersion`.

For each quantity, require simultaneously:

```text
worstCaseBudgetedLoss <= sizingEquity * riskPerTradePct / 100
account.openRisk + candidateLoss <= sizingEquity * maxOpenRiskPct / 100
account.usedMargin + candidateMargin <= sizingEquity * maxMarginUsagePct / 100
account.grossExposure + candidateExposure <= sizingEquity * maxGrossExposurePct / 100
allowedRiskGroupExposure =
  sizingEquity * riskGroupMaxExposurePct[product.riskGroup] / 100
riskGroupExposure + candidateExposure <= allowedRiskGroupExposure
account.availableFunds - candidateMargin - candidateCosts
  >= sizingEquity * cashReservePct / 100
```

Resolve `riskGroupMaxExposurePct[product.riskGroup]` before the grid search. A
missing own key is `RiskInputError('INVALID_RISK_INPUT')`; do not use a fallback,
another group's value, or a default. Add exact boundary tests proving equality
with `allowedRiskGroupExposure` passes and one exact increment fails with
`RISK_GROUP_EXPOSURE`.

Retain the greatest admissible quantity. Do not stop at the first failure because
fee minima and tiers are nonlinear. If no candidate is admissible, return zero
and the reasons observed for `minQuantity`; never round up. A supplied requested
quantity must be a positive canonical decimal aligned to `quantityStep`. A
request below `minQuantity` rejects with `MIN_QUANTITY`; an off-grid request is
an `INVALID_RISK_INPUT` error.

When `requestedQuantity` is absent, approve the maximum admissible quantity. When
it is present, search only quantities less than or equal to both the request and
`maxContractsPerPosition`: approve the exact request if admissible, reduce to the
greatest lower admissible quantity otherwise, and attach the requested
quantity's failed constraints as ordered reasons. Reject if no lower quantity is
admissible. If the explicit request exceeds `maxContractsPerPosition`, always add
`MAX_CONTRACTS_PER_POSITION` in its declared precedence position. Return
`REDUCE_SIZE` with that reason when a capped quantity is feasible. If none is
feasible, return `REJECT` with that reason plus the applicable reasons evaluated
at `minQuantity`. With no explicit request, the contracts cap is only the search
bound and never adds this reason.

- [ ] **Step 6: Run focused GREEN and branch coverage**

Run:

```bash
pnpm test packages/risk/src/evaluate.test.ts
pnpm exec vitest run packages/risk/src/evaluate.test.ts --coverage
pnpm lint
pnpm typecheck
```

Expected: every public result branch and every reason branch is executed; all
commands exit `0`.

- [ ] **Step 7: Commit the evaluator**

```bash
git add packages/risk
git commit -m "feat(risk): size futures orders under portfolio limits"
```

---

### Task 8: Add FDXS/MES research fixtures and causal integration tests

**Files:**

- Create: `packages/test-helpers/src/futures.ts`
- Modify: `packages/test-helpers/src/index.ts`
- Create: `packages/risk/src/causality.test.ts`
- Modify: `packages/risk/src/evaluate.test.ts`

- [ ] **Step 1: Write failing imports for synthetic futures fixtures**

Add tests importing:

```ts
import {
  syntheticFdxsContract,
  syntheticFdxsProduct,
  syntheticMesContract,
  syntheticMesProduct,
} from '@trading-auto/test-helpers';
```

Assert exact exchange/product/currency/tick economics and `Object.isFrozen` for
all four fixtures.

- [ ] **Step 2: Run the fixture consumers to establish RED**

Run:

```bash
pnpm test packages/risk/src/evaluate.test.ts packages/risk/src/causality.test.ts
```

Expected: FAIL because the four fixture exports are absent.

- [ ] **Step 3: Implement deterministic FDXS and MES domain fixtures**

Use these research-only product economics:

```text
FDXS: EUR P&L, tickSize 0.5, tickValue 0.5,
      monetaryValuePerPriceUnit 1, quantity step/minimum 1
MES:  USD P&L, tickSize 0.25, tickValue 1.25,
      monetaryValuePerPriceUnit 5, quantity step/minimum 1
```

Use explicitly dated synthetic March 2026 contract identifiers and UTC lifecycle
instants. Do not add margin, fee, or eligibility claims to domain fixtures; those
remain risk-test snapshots with `source: 'SYNTHETIC_TEST_ONLY'`.

- [ ] **Step 4: Add end-to-end 2A tests**

Cover these scenarios:

```text
initial 100% gross-exposure policy rejects FDXS and MES
an explicitly relaxed synthetic policy can approve one FDXS contract
MES direct USD/EUR and inverse EUR/USD produce identical decisions
one-contract Kijun risk above EUR 5 rejects without forced rounding
realized gains do not enlarge sizing above the active EUR 1,000 cap
new cap version at EUR 1,200 permits a larger sizing budget
unrealized gain has no effect
unrealized loss reduces or rejects quantity immediately
existing same-instrument position and intent reject
mixed FDXS/MES positions respect aggregate and risk-group limits
risk-group equality passes and a missing product risk-group key is invalid input
requested quantity above the contracts cap reduces or rejects with
  MAX_CONTRACTS_PER_POSITION; implicit sizing uses the cap without that reason
FORWARD and HISTORICAL_RESEARCH policy-use modes preserve their time invariants
HISTORICAL_RESEARCH requires backtestId/runCreatedAt; FORWARD rejects both
each fixed M2A safety assertion mismatch is invalid independently from policy
  mirror mismatch
ambient Decimal configuration does not affect the decision
```

Create a causality test that evaluates at `09:00Z`, appends valid snapshots
observed at `10:00Z`, reselects the snapshot bundle, and requires deep equality of
the entire decision.

- [ ] **Step 5: Run integration GREEN and full repository checks**

Run:

```bash
pnpm test packages/risk
pnpm test:coverage
pnpm check
git diff --check
```

Expected: all tests and gates pass. Review the risk package's focused coverage;
any uncovered business branch must receive a test before commit. Defensive
unreachable guards may remain uncovered only when documented in the test report.

- [ ] **Step 6: Commit fixtures and integration coverage**

```bash
git add packages/test-helpers packages/risk
git commit -m "test(risk): prove futures sizing causality"
```

---

### Task 9: Document Milestone 2A and run the release-quality gate

**Files:**

- Create: `docs/milestones/futures-risk.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-10-futures-risk-execution-backtest-design.md`

- [ ] **Step 1: Write the milestone record**

Create `docs/milestones/futures-risk.md` with these explicit sections:

```text
Status: RESEARCH_ONLY
Delivered contracts
Capital and compounding policy
FDXS/MES fixture limitations
Risk reasons and exact-decimal invariants
Causal policy-use modes and activation chronology
Causality and reproducibility guarantees
Verification commands and observed counts
Deferred to 2B
Deferred to 2C
Not executable without dated broker data
```

State that `maxSizingCapital` starts at EUR 1,000 and changes only through a new
manual policy version. State that FDXS/MES acceptance tests use synthetic margin,
FX, cost, and exposure scenarios and make no real eligibility claim.

- [ ] **Step 2: Update the README package and scope sections**

Add:

```text
- `@trading-auto/risk`: moteur de risque futures causal et décimal exact,
  avec sizing asymétrique, coûts, FX, marge, exposition et raisons stables.
```

Link the new milestone record and retain execution, backtesting, broker, UI, and
live trading under the deferred scope.

- [ ] **Step 3: Mark the design implementation status accurately**

Change only the status line in the design after the code is complete:

```text
Status: Milestone 2A implemented; Milestones 2B and 2C remain planned
```

- [ ] **Step 4: Run fresh release-quality verification**

Run from a clean dependency installation:

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm test:coverage
pnpm audit --prod
git diff --check
```

Expected:

```text
frozen lockfile installation succeeds
format, lint, TypeScript, tests, and build succeed
coverage completes with no uncovered business branch accepted silently
production dependency audit reports no known vulnerability
diff check reports no whitespace error
```

- [ ] **Step 5: Inspect the public package boundary**

Run:

```bash
pnpm build
node --input-type=module -e "import('./packages/risk/dist/index.js').then(m => console.log(Object.keys(m).sort()))"
sed -n '1,240p' packages/risk/dist/index.d.ts
```

Expected: the runtime list contains only public value exports (factories,
selectors, equity helper, evaluator, and error class), while `index.d.ts` also
contains the declared public types. Neither output exposes the Decimal clone,
grid internals, fee accumulator, test builders, or fixtures.

- [ ] **Step 6: Request independent review before the final commit**

The review must compare the complete 2A diff against the design and this plan,
reproduce FDXS/MES economics independently, mutate global Decimal configuration,
append future snapshots, and inspect all public exports. Fix every verified
Critical or Important finding with a red-green regression cycle before
continuing.

- [ ] **Step 7: Commit the milestone documentation**

```bash
git add README.md docs
git commit -m "docs: record futures risk milestone"
```

- [ ] **Step 8: Verify the committed branch is clean**

Run:

```bash
pnpm check
git status --short
git log -1 --oneline
```

Expected: all gates pass, `git status --short` prints nothing, and the final log
entry is `docs: record futures risk milestone`.

Do not merge, push, create a PR, remove the worktree, or begin Milestone 2B until
the user chooses the integration action after the verified implementation review.
