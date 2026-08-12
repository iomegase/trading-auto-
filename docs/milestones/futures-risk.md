# Milestone 2A — Futures Domain and Risk Engine

Status: RESEARCH_ONLY

Cette milestone ajoute au noyau de recherche une frontière de domaine pour les
futures datés et un moteur de risque pur. Elle ne place aucun ordre, ne simule
aucune exécution et ne prétend pas qu'un contrat est négociable chez un broker.

## Contrats livrés

- `FuturesProduct` et `FuturesContract` distinguent les caractéristiques
  économiques d'un produit de son échéance datée. Les devises, le tick, la
  valeur du tick, la valeur monétaire par unité de prix, le pas, la quantité
  minimale et le groupe de risque sont validés à la construction.
- Les snapshots immuables de FX, marge, coûts et éligibilité portent leur
  version, source, instant d'observation et intervalle de validité. Leur
  sélection est causale et rattachée au contrat ou à la paire de devises
  concernée.
- `RiskPolicyVersion`, l'état du compte et celui du portefeuille sont validés et
  immuables. Les limites de risque, marge, exposition brute et exposition par
  groupe proviennent uniquement de la policy approuvée.
- Le calcul économique couvre la perte au stop, les frais à paliers et minimums,
  les coûts d'entrée et de sortie, la marge, le notionnel brut et la conversion
  FX directe ou inverse.
- `evaluateOrderRisk` recherche une quantité finie sur la grille du produit et
  retourne `APPROVE`, `REDUCE_SIZE` ou `REJECT`, avec un contexte versionné et
  reproductible.

## Politique de capital et de capitalisation

La policy initiale fixe `initialCapital = 1000 EUR` et
`maxSizingCapital = 1000 EUR`. Ces deux valeurs ont des rôles distincts :
`initialCapital` est le capital de départ historique, tandis que
`maxSizingCapital` est le plafond de capital utilisable par le sizing pour une
version donnée. Il n'existe pas de plafond permanent du capital. Une hausse ou
une baisse de `maxSizingCapital` exige une nouvelle policy manuelle, approuvée,
versionnée et activée ; l'equity, un résultat de backtest ou le programme ne
peuvent jamais l'augmenter automatiquement.

Le sizing est asymétrique :

```text
asymmetricEquity = realizedEquity + min(0, unrealizedPnl)
sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)
```

Les pertes latentes diminuent donc immédiatement le capital de sizing, alors
que les gains latents ne permettent pas d'agrandir une nouvelle position. Les
gains réalisés peuvent être composés dans la limite de la policy active. Toute
injection de cash reste interdite.

## Limites des fixtures FDXS/MES

Les fixtures `FDXS` et `MES` sont des contrats datés synthétiques destinés aux
tests d'acceptation. Les scénarios de marge, FX, coûts, éligibilité et exposition
sont eux aussi synthétiques. Ils vérifient les formules et les invariants du
moteur mais ne constituent aucune preuve d'éligibilité réelle, de tarif broker,
de marge exigible, de liquidité ou de permission de marché.

FDXS exerce le chemin économique EUR sans conversion FX. MES exerce un P&L en
USD converti causalement vers le compte EUR, avec des scénarios directs et
inverses équivalents. Ces fixtures ne doivent pas être interprétées comme des
données de production.

## Raisons de risque et invariants décimaux exacts

Les raisons sont stables, sans doublon et ordonnées par précédence :

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

Les prix, quantités, montants, taux, marges, expositions, frais et P&L restent
des chaînes décimales canoniques aux frontières exécutables. Les calculs
utilisent un clone isolé de `decimal.js` : une mutation de sa configuration
globale ne doit pas changer un résultat. La cohérence du tick et la grille de
quantité sont contrôlées exactement, sans conversion intermédiaire en
`number`, et la recherche de quantité est explicitement bornée.

## Modes causaux d'utilisation de policy et chronologie d'activation

Chaque décision conserve `riskPolicyUseMode` et `riskPolicyUseAt` :

- `HISTORICAL_RESEARCH` utilise le `runCreatedAt` immuable du run et exige un
  `backtestId` ; les décisions de marché peuvent précéder cet instant sans
  prétendre que la policy existait historiquement ;
- `FORWARD` exige `riskPolicyUseAt = decisionAt` et n'accepte aucun lien de
  backtest historique.

Dans les deux modes, `approvedAt <= activatedAt <= riskPolicyUseAt`. Une policy
ne peut donc pas être appliquée avant son approbation et son activation. Le mode
`FORWARD` formalise uniquement cette contrainte chronologique dans 2A ; il
n'active ni paper trading ni exécution live.

## Garanties de causalité et de reproductibilité

À un `decisionAt` donné, seuls les snapshots opérationnels déjà observés et
valides peuvent être sélectionnés. Ajouter ultérieurement des snapshots futurs
de FX, marge, coûts ou éligibilité ne modifie pas une décision passée. Les
entrées futures observées, incohérentes, associées au mauvais contrat ou à une
paire FX sans rapport sont refusées aux frontières publiques.

Chaque décision conserve les versions du dataset, de la stratégie, de la
policy, du FX éventuel, de la marge, des coûts et de l'éligibilité, ainsi que le
contrat daté, les prix d'entrée et de stop et les instants causaux. À entrées
identiques, l'évaluation et l'ordre des raisons sont déterministes et les
résultats sont immuables.

## Commandes de vérification et décomptes observés

La gate locale de la milestone est :

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm test:coverage
pnpm audit --prod
git diff --check
```

Au 12 août 2026, `pnpm check` et `pnpm test:coverage` exécutent chacun 21 fichiers
de tests et 806 tests automatisés. Les contrôles locaux de formatage, ESLint,
typage TypeScript strict, tests Vitest, compilation, couverture et inspection du
boundary public compilé de `@trading-auto/risk` réussissent. L'audit réseau
`pnpm audit --prod` ne signale aucune vulnérabilité connue dans les dépendances
de production au moment de cette vérification.

## Différé à 2B

L'exécution conservatrice sur barres H1, la politique d'ambiguïté
`STOP_FIRST`, les sessions et pauses de maintenance, le slippage, les ordres
d'entrée/stop, les settlements et le roll avec sortie puis réentrée restent à
implémenter dans Milestone 2B.

## Différé à 2C

L'orchestration séquentielle du portefeuille, le moteur de backtest, les
enregistrements de runs et de décisions, les statistiques, la restitution et
les comparaisons reproductibles de runs restent à implémenter dans Milestone
2C.

## Non exécutable sans données broker datées

Milestone 2A reste `RESEARCH_ONLY`. Elle n'est pas exécutable sur un marché réel
sans données broker datées et vérifiées pour le contrat, les permissions, la
marge, les coûts, le FX, les horaires, la liquidité et les règles opérationnelles.
Le broker, le paper trading, l'interface, la persistance et toute activation
live demeurent hors périmètre ; aucune promesse de production ou de performance
financière n'est formulée.
