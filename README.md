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

Cette première milestone fournit uniquement un noyau de recherche déterministe
et testé. Elle n'inclut encore ni calendriers de session (jours fériés, DST), ni
resampling H1→H4, gestion du risque ou sizing, moteur de backtest, interface,
persistance, paper trading, connexion broker ou exécution live.

Voir le [bilan de la milestone](docs/milestones/core-research.md), le
[design approuvé](docs/superpowers/specs/2026-08-09-core-research-milestone-design.md)
et le [plan de durcissement faisant autorité](docs/superpowers/plans/2026-08-09-core-research-hardening.md).
