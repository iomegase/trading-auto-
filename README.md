# Trading Auto

Spécifications d'une plateforme de recherche, de backtest et de paper trading pour une stratégie Ichimoku H4/H1.

La baseline démarre avec `initialCapital = 1 000 EUR` et interdit toute injection de cash. Le capital de sizing est l'equity réalisée diminuée immédiatement des pertes latentes, sans inclure les gains latents, puis bornée par le `maxSizingCapital` de la `RiskPolicyVersion` active. Le plafond initial vaut `1 000 EUR`; toute augmentation est manuelle, auditée et versionnée. Ce cadre reste une contrainte de sizing et de marge, pas une promesse de perte maximale en présence de gaps ou de produits à effet de levier.

- [Index des spécifications](specs/00-README.md)
- [Configuration de recherche](specs/23-STRATEGY-CONFIG.example.json)
- [Audit et corrections V3](specs/30-AUDIT-CORRECTIONS-V3.md)

Statut : recherche uniquement. Toute exécution réelle reste désactivée.

## Démarrage

Prérequis : Node.js `>=22.15.0` et Corepack.

```bash
corepack enable
pnpm install
pnpm check
```

`pnpm check` vérifie le formatage, ESLint, le typage strict, les tests Vitest et
la compilation de tous les packages.

## Packages du noyau de recherche

- `@trading-auto/domain` : types immuables, instants normalisés en UTC et
  validation stricte des bougies, décimaux et séries chronologiques.
- `@trading-auto/calendars` : sélection causale d'une paire bougie/snapshot H4
  clôturée, complète et réellement disponible à l'instant de décision.
- `@trading-auto/indicators` : calcul Ichimoku versionné, aligné dans le temps,
  avec provenance et Kijun décimal exact.
- `@trading-auto/strategy-ichimoku` : pipeline causal H4/H1, breakout,
  qualification et stop Kijun exact arrondi au tick de l'instrument.
- `@trading-auto/risk` : moteur de risque futures causal et décimal exact, avec
  sizing asymétrique, coûts, FX, marge, exposition et raisons stables.
- `@trading-auto/execution` : simulateur causal d'exécution futures sur barres
  H1, avec sessions versionnées, revalidation du risque à l'ouverture, stops,
  settlements et roll explicite entre contrats datés.
- `@trading-auto/backtester` : kernel séquentiel causal avec horloge
  déterministe, ledger équilibré et état de portefeuille immuable. L'orchestration
  stratégie/risque/exécution reste différée à PR 2C.2.
- `@trading-auto/test-helpers` : construction de fixtures validées pour les
  tests.

Le compilateur applicatif est TypeScript 7 via `@typescript/native`. L'alias
TypeScript 6 reste installé uniquement pour l'API attendue par
`typescript-eslint`; `pnpm typecheck` exécute bien le compilateur TypeScript 7.

## API de décision sûre

`evaluateIchimokuDecision` est l'unique API publique pouvant produire une
décision `APPROVED`. Son entrée complète
[`IchimokuDecisionInput`](packages/strategy-ichimoku/src/decision.ts) contient la
direction, les séries H1 et H4, `signalIndex`, `breakoutLookback`, `decisionAt`,
la configuration Ichimoku versionnée, les versions du dataset et de la
stratégie, le prix de référence et le tick. Elle calcule les préfixes causaux,
sélectionne le dernier snapshot H4 disponible, puis évalue régime, candidat et
stop dans cet ordre.

Avant tout résultat, les entrées H1, lookback, prix et tick sont validés. Une H4
clôturée mais publiée après `decisionAt` n'est jamais convertie par l'indicateur,
et toutes les bougies du préfixe d'un snapshot sélectionné doivent être
clôturées et disponibles.

Le résultat immuable est `UNAVAILABLE`, `REJECTED` ou `APPROVED`. Une absence de
H4 exploitable conserve la raison `NO_CLOSED_TREND_CANDLE` ou
`INSUFFICIENT_DATA`; une décision évaluée conserve les timestamps H1/H4, les
versions dataset/stratégie/configuration et les raisons métier. L'évaluateur H1
brut reste interne au package afin qu'un appelant ne puisse pas contourner la
sélection H4.

Les instants économiques sont sérialisés sous forme UTC canonique. Le texte
local du fournisseur reste conservé séparément dans `sourceTimestamp`.

## Périmètre actuel

Le périmètre actuel réunit le noyau Ichimoku causal de Milestone 1, le moteur de
risque futures de Milestone 2A, le simulateur d'exécution sur barres H1 de
Milestone 2B et le kernel de portefeuille/comptabilité de PR 2C.1. Le
simulateur consomme des contrats datés et des horaires fournis, revalide le
risque au prochain open disponible, puis modélise de façon conservatrice les
stops, les sorties de tendance différées, settlements et rollovers. Le kernel
2C.1 ordonne les événements et réconcilie le ledger, mais ne lance pas encore un
run complet. Tout ce périmètre reste `RESEARCH_ONLY` et ne place aucun ordre
réel.

Restent différés l'acquisition de calendriers et données broker réels, le
resampling H1→H4, l'orchestration complète du backtest en PR 2C.2, le résultat
et les statistiques en PR 2C.3, l'interface, la persistance, le paper trading,
la connexion broker et toute exécution live. L'absence de données minute, tick,
carnet d'ordres et fills partiels interdit d'interpréter les fills simulés comme
une preuve de qualité d'exécution réelle.

Voir les bilans de [Milestone 1](docs/milestones/core-research.md) et de
[Milestone 2A](docs/milestones/futures-risk.md), de
[Milestone 2B](docs/milestones/futures-execution.md), de
[Milestone 2C.1](docs/milestones/futures-backtester-core.md), ainsi que le
[design Futures Risk, Execution and Backtest](docs/superpowers/specs/2026-08-10-futures-risk-execution-backtest-design.md).
