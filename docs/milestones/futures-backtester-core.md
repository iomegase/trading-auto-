# Milestone 2C.1 — Futures Backtester Core

Status: RESEARCH_ONLY

Cette première tranche de Milestone 2C livre le noyau comptable et causal du
backtester séquentiel. Elle fournit une horloge déterministe, un journal exact,
un état de portefeuille immuable et un reducer interne. Elle n'orchestre pas
encore la stratégie, le risque et l'exécution sur un dataset complet, et ne
produit ni résultat final ni métriques de performance.

## Périmètre livré

Le package `@trading-auto/backtester` apporte :

- neuf types d'événements immuables avec identité sémantique, instant de
  disponibilité UTC canonique et provenance explicite ;
- une horloge bornée qui filtre causalement avant de lire le payload et trie
  indépendamment de l'ordre d'insertion ;
- un ledger append-only, équilibré exactement et réconcilié au cash après
  chaque transition ;
- un état de run et de portefeuille immuable rattaché à une unique policy de
  risque approuvée ;
- des agrégats exacts de cash, equity, marge, exposition brute, risque ouvert
  et exposition par groupe ;
- les modes opérationnels `RUNNING` et `NO_NEW_ENTRIES` ;
- un reducer interne de transitions de portefeuille, volontairement absent de
  l'API publique ;
- des erreurs typées et des frontières résistantes aux entrées runtime
  hostiles.

PR 2C.1 reste un kernel. Elle ne lit pas encore les datasets H1/H4 et n'appelle
pas automatiquement les APIs de stratégie ou d'exécution.

## Frontière publique exacte

La build ESM expose exactement les dix valeurs runtime suivantes :

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

Les types TypeScript associés sont publics. Le clone Decimal, les helpers de
validation, les clés d'horloge, le reducer, les transitions et les builders de
tests restent privés.

## Capital, policy et chronologie

Chaque run démarre exactement avec `initialCash = 1 000 EUR`. Le ledger
d'initialisation contient un débit `CAPITAL = -1000` et un crédit
`CASH = 1000`. Tout posting `CAPITAL` ultérieur est rejeté : aucune injection
de cash n'est possible.

La `RiskPolicyVersion` approuvée est capturée une seule fois au démarrage puis
reste fixe. Le reducer ne peut modifier ni sa version, ni le
`maxSizingCapital`, ni le `backtestId`, ni `runCreatedAt`, ni
`riskPolicyUseAt`. Cette tranche accepte uniquement :

```text
riskPolicyUseMode = HISTORICAL_RESEARCH
riskPolicyUseAt = runCreatedAt
approvedAt <= activatedAt <= riskPolicyUseAt
```

Le sizing conserve la règle asymétrique du moteur de risque : les pertes
latentes réduisent immédiatement le capital utilisable, tandis que les gains
latents ne l'augmentent pas. Une hausse progressive du sizing ne peut provenir
que de gains réalisés et reste bornée par le plafond fixe d'une policy
approuvée séparément.

## Horloge déterministe

À instant `availableAt` égal, la priorité est fixe :

```text
0 DATA_AVAILABLE
1 CLOSED_BAR_POSITION
2 DAILY_SETTLEMENT
3 ROLL
4 OPEN_EXIT
5 OPEN_ENTRY
6 SIGNAL_DECISION
7 PORTFOLIO_SNAPSHOT
8 SESSION_END
```

L'identité sémantique tranche ensuite par comparaison bytewise. Une collision
d'identité invalide le dataset. Une donnée située après `endAt` est écartée
après lecture de son seul `availableAt` : ses autres champs et son payload ne
sont jamais consultés. Ajouter un événement futur hostile ne change donc pas
l'état obtenu à l'instant évalué.

Le reducer contrôle la monotonie des clés par comparaison d'instants réels,
pas par ordre lexical. Il réconcilie aussi la provenance instrument/contrat de
l'événement avec l'entité affectée par la transition.

## Ledger et invariants comptables

Chaque entrée possède au moins deux postings non nuls, de signes opposés, et
leur somme décimale exacte vaut zéro. Les comptes autorisés sont :

```text
CASH
CAPITAL
COSTS
PNL_CLEARING
FX_TRANSLATION
```

`FX_TRANSLATION` exige une version de snapshot FX, et cette version est refusée
sur une écriture domestique. Après chaque transition, le noyau reconstruit et
vérifie notamment :

```text
cash = somme de tous les postings CASH
realizedEquity = cash
availableFunds = cash + unrealizedPnl - usedMargin - reservedMargin
```

L'ouverture retire atomiquement son intention, débite exactement le coût
d'entrée conservé par la position et refuse une position liée à une autre
policy. Une revalorisation ne peut modifier que le P&L latent. Les règlements
et autres mouvements réalisés passent par une écriture comptable explicite.

## États opérationnels

`RUNNING` autorise l'enregistrement de nouvelles intentions. Quand une donnée
ou une capacité requise manque, `NO_NEW_ENTRIES` bloque seulement les nouvelles
entrées. Les revalorisations, règlements et sorties d'une position existante
restent possibles afin de ne jamais transformer une dégradation de données en
blocage de la gestion du risque.

Le retour à `RUNNING` est une transition explicite ; le kernel suppose que
l'orchestrateur futur a d'abord restauré causalement les prérequis.

## Bornes et entrées hostiles

Les principales limites de sécurité sont :

- 1 000 000 événements en file ;
- 1 000 000 écritures comptables ;
- 32 postings par écriture ;
- 1 000 positions ou intentions actives ;
- 10 000 snapshots quotidiens ;
- 256 clés par objet runtime ;
- payload JSON limité à 16 niveaux, 1 024 nœuds et 10 000 éléments par
  tableau.

Les limites de collection sont testées avant tout parcours d'index ou calcul
Decimal. Les tableaux creux, champs hérités ou non énumérables, getters
hostiles, traps de descripteur, proxies révoqués, cycles, casts forgés et
mutations après appel sont rejetés ou détachés avec des erreurs stables. Les
calculs utilisent un clone Decimal privé et restent identiques après mutation
de la configuration globale de `decimal.js`.

## Vérification observée

La gate locale comprend :

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

Au 15 août 2026, `pnpm check` exécute 41 fichiers et 1 259 tests. La suite
ciblée du Backtester exécute 227 tests et couvre exactement 100 % des
statements, branches, fonctions et lignes de production du package. La
frontière ESM compilée est comparée à la liste exacte des dix exports ci-dessus.

Au 15 août 2026, l'audit réseau des dépendances de production ne signale aucune
vulnérabilité connue. Ce constat décrit le résultat de la gate à cette date et
doit être réévalué avant chaque publication ultérieure.

## Différé à PR 2C.2 et PR 2C.3

PR 2C.2 doit encore composer causalement les calendriers, la stratégie, le
moteur de risque et l'exécution pour traiter les barres H1/H4, entrées, stops,
sorties différées, settlements et rollovers d'un run complet.

PR 2C.3 doit produire l'artefact final reproductible, la série d'equity, les
trades et les métriques déterministes. La persistance, l'API, l'interface, le
paper trading et le broker restent différés au-delà de Milestone 2C.

## Non exécutable en réel

Milestone 2C.1 reste `RESEARCH_ONLY`. Elle ne place aucun ordre, ne contacte
aucun broker et ne valide ni liquidité, ni marge réelle, ni permissions de
marché. Sans données broker datées et sans les tranches 2C.2/2C.3, ce kernel ne
constitue pas encore un moteur de backtest opérationnel complet.
