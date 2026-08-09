# Trading Auto

Spécifications d'une plateforme de recherche, de backtest et de paper trading pour une stratégie Ichimoku H4/H1.

La stratégie est conçue avec un capital de référence en EUR strictement plafonné à **1 000 €**. Ce plafond est une contrainte de sizing et de marge, pas une promesse de perte maximale en présence de gaps ou de produits à effet de levier.

- [Index des spécifications](specs/00-README.md)
- [Configuration de recherche](specs/23-STRATEGY-CONFIG.example.json)
- [Audit et corrections V3](specs/30-AUDIT-CORRECTIONS-V3.md)

Statut : recherche uniquement. Toute exécution réelle reste désactivée.

## Démarrage

Prérequis : Node.js 24 et Corepack.

```bash
corepack enable
pnpm install
pnpm check
```

`pnpm check` vérifie le formatage, ESLint, le typage strict, les tests Vitest et
la compilation de tous les packages.

## Packages du noyau de recherche

- `@trading-auto/domain` : types immuables et validation des bougies, décimaux
  et instants.
- `@trading-auto/calendars` : sélection causale de la dernière bougie clôturée
  et disponible à l'instant de décision.
- `@trading-auto/indicators` : calcul Ichimoku aligné dans le temps, sans accès
  aux données futures.
- `@trading-auto/strategy-ichimoku` : régime H4, breakout H1, qualification des
  candidats et proposition du stop Kijun.
- `@trading-auto/test-helpers` : construction de fixtures validées pour les
  tests.

Le compilateur applicatif est TypeScript 7 via `@typescript/native`. L'alias
TypeScript 6 reste installé uniquement pour l'API attendue par
`typescript-eslint`; `pnpm typecheck` exécute bien le compilateur TypeScript 7.

## Périmètre actuel

Cette première milestone fournit uniquement un noyau de recherche déterministe
et testé. Elle n'inclut encore ni gestion du risque ou sizing, ni moteur de
backtest, interface, persistance, paper trading, connexion broker ou exécution
live.

Voir le [bilan de la milestone](docs/milestones/core-research.md), le
[design approuvé](docs/superpowers/specs/2026-08-09-core-research-milestone-design.md)
et le [plan d'implémentation](docs/superpowers/plans/2026-08-09-core-research-milestone.md).
