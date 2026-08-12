# Database Schema

## instruments

- id
- symbol
- provider_symbol
- exchange
- asset_class
- quote_currency
- pnl_currency
- exchange_timezone
- tick_size
- tick_value
- monetary_value_per_price_unit
- quantity_step
- min_quantity
- contract_multiplier
- session_calendar_id
- risk_group
- active

Invariant : `tick_value / tick_size` doit être cohérent avec `monetary_value_per_price_unit`. `contract_multiplier` est conservé comme métadonnée et ne doit pas être appliqué une seconde fois si la valeur monétaire l'intègre déjà.

## accounts

- id
- broker
- account_currency
- account_type
- created_at

La baseline 2A n'accepte que des comptes dont `account_currency = EUR`.

## risk_policy_versions

- id
- version (`UNIQUE`)
- approval_status (`APPROVED`)
- reference_currency
- account_currency
- initial_capital_account_ccy
- max_sizing_capital_account_ccy
- risk_per_trade_pct
- max_open_risk_pct
- max_open_positions
- max_contracts_per_position
- max_gross_exposure_pct
- max_margin_usage_pct
- cash_reserve_pct
- daily_loss_limit_pct
- max_drawdown_pct
- risk_group_max_exposure_pct_json
- allow_cash_injection
- sizing_equity_mode
- cap_increase_mode
- approved_by
- approved_at
- activated_at
- created_at

Une ligne est une version approuvée et immuable dès son insertion. Les brouillons
vivent hors de cette table; l'approbation manuelle crée la ligne immuable. La
baseline exige `approval_status = APPROVED`,
`reference_currency = account_currency = EUR`,
`initial_capital_account_ccy = 1000.00`, un `approved_by` non vide et des instants
canoniques avec `approved_at <= activated_at`. La table d'usage porte séparément
le mode et l'instant auxquels l'activation est contrôlée.

## strategy_capital_allocations

Cette table persiste la politique ADR-011 :

```txt
asymmetricEquity = realizedEquity + min(0, unrealizedPnl)
sizingEquity = min(max(0, asymmetricEquity), maxSizingCapital)
```

- id
- account_id
- strategy_version_id
- risk_policy_version_id
- reference_currency (`EUR`)
- account_currency (`EUR`)
- initial_capital_account_ccy (`1000.00`)
- max_sizing_capital_account_ccy
- realized_equity_account_ccy
- unrealized_pnl_account_ccy
- asymmetric_equity_account_ccy
- sizing_equity_account_ccy
- effective_from
- effective_to

Les allocations 2A sont intégralement tenues en EUR. Aucun taux FX ne convertit
le capital initial ou le plafond de sizing. Le P&L d'un produit dans une autre
devise, notamment MES en USD, est converti causalement vers le compte EUR avant
la mise à jour des montants de capital.

## datasets

- id
- provider
- version
- created_at
- checksum
- metadata_json

## candles

- dataset_id
- instrument_id
- timeframe
- source_timestamp
- source_timezone
- exchange_timezone
- open_time
- close_time
- available_at
- open
- high
- low
- close
- volume
- is_closed
- provider
- ingested_at

Unique :
`dataset_id + instrument_id + timeframe + open_time`

## strategy_versions

- id
- strategy_key
- version
- config_json
- config_hash
- code_hash
- created_at

## signals

- id
- instrument_id
- strategy_version_id
- dataset_id
- signal_timeframe
- decision_at
- signal_candle_close_time
- trend_candle_close_time
- direction
- status
- setup_score
- proposed_stop
- expires_at
- reasons_json
- indicator_snapshot_json

## risk_decisions

- id
- signal_id
- backtest_id (nullable)
- risk_policy_version_id
- risk_policy_use_mode
- risk_policy_use_at
- decision_at
- evaluated_at
- decision
- requested_risk_account_ccy
- requested_quantity (nullable)
- sizing_equity_account_ccy
- risk_budget_account_ccy
- budgeted_costs_account_ccy
- budgeted_loss_account_ccy
- margin_required_account_ccy
- gross_exposure_account_ccy
- account_currency
- fx_rate
- fx_as_of
- approved_quantity
- entry_reference_price
- stop_price
- reasons_json

Clés et index :

- FK `risk_decisions.backtest_id -> backtests.id`
- FK `risk_decisions.risk_policy_version_id -> risk_policy_versions.id`
- index partiel `risk_decisions(backtest_id, decision_at)` où
  `backtest_id IS NOT NULL`
- index `risk_decisions(risk_policy_version_id, risk_policy_use_at)`

## order_intents

- id
- signal_id (nullable pour une intention non créée par un nouveau signal)
- position_id (nullable)
- strategy_version_id
- instrument_id
- account_id
- intent_type
- requested_quantity
- status
- expires_at
- created_at

Index unique partiel : une seule intention `ENTRY` active par `account_id + strategy_version_id + instrument_id`.

## orders

- id
- signal_id (nullable pour stop/sortie)
- risk_decision_id
- account_id
- broker
- order_intent_id
- intent_type
- idempotency_key
- client_order_id
- external_order_id
- side
- order_type
- quantity
- status
- created_at
- updated_at

Unique : `broker + account_id + idempotency_key`.

## fills

- id
- order_id
- external_fill_id
- fill_time
- quantity
- price
- commission
- fee_currency

## positions

- id
- account_id
- strategy_version_id
- instrument_id
- side
- quantity
- average_entry_price
- protective_stop_price
- initial_risk_account_ccy
- margin_reserved_account_ccy
- opened_at
- closed_at

Index unique partiel : une seule position ouverte par `account_id + strategy_version_id + instrument_id`.

## trades

- id
- signal_id
- position_id
- entry_price
- exit_price
- initial_risk_account_ccy
- realized_pnl_account_ccy
- r_multiple
- total_fees_account_ccy
- slippage_account_ccy
- opened_at
- closed_at

## backtests

- id
- strategy_version_id
- risk_policy_version_id
- dataset_id
- code_hash
- config_hash
- cost_model_version
- execution_model_version
- random_seed
- account_currency
- initial_capital_account_ccy
- max_sizing_capital_account_ccy
- risk_policy_use_mode (`HISTORICAL_RESEARCH`)
- risk_policy_use_at
- date_from
- date_to
- status
- metrics_json
- created_at

Pour la baseline, `backtests.account_currency = EUR` et
`initial_capital_account_ccy = 1000.00 EUR`. `risk_policy_use_at = created_at` en
mode `HISTORICAL_RESEARCH` et reste immuable. Le backtest ne réalise aucune
conversion FX du plafond de capital.

## equity_snapshots

- run_id
- timestamp
- cash
- equity
- open_pnl
- realized_pnl
- drawdown

## Types et contraintes

- montants, prix et quantités : `NUMERIC`, jamais `REAL`/`DOUBLE PRECISION`
- timestamps métier : `TIMESTAMPTZ`
- `initial_capital_account_ccy = 1000` pour la baseline
- les clés `risk_policy_version_id` référencent une version `APPROVED` et
  immuable; aucun brouillon n'est persisté dans `risk_policy_versions`
- tout usage vérifie
  `approved_at <= activated_at <= risk_policy_use_at`
- `risk_policy_use_mode` appartient à
  `HISTORICAL_RESEARCH | FORWARD`
- en `FORWARD`, `risk_decisions.backtest_id IS NULL` et
  `risk_policy_use_at = decision_at`
- en `HISTORICAL_RESEARCH`, `risk_decisions.backtest_id IS NOT NULL` et
  `risk_policy_use_at =` le `created_at` du `backtests` référencé, même si le
  `decision_at` de marché est antérieur
- quantités positives et alignées sur `quantity_step`
- prix alignés sur `tick_size` avant soumission
- clés étrangères et contraintes d'unicité explicites pour fills, intents et snapshots
- `backtests.max_sizing_capital_account_ccy` provient de la `RiskPolicyVersion` active
- unicité des fills au minimum sur `order_id + external_fill_id`

Le mapping TypeScript/SQL est explicite : `initialCapital` et
`initialCapitalAccountCcy` correspondent à `initial_capital_account_ccy`, tandis
que `maxSizingCapital` et `maxSizingCapitalAccountCcy` correspondent à
`max_sizing_capital_account_ccy`.

À la lecture, tout `NUMERIC` est normalisé avant validation en `DecimalString` :
les zéros fractionnaires finaux sont supprimés sans modifier la valeur. Ainsi,
une valeur SQL équivalente à `1000.00` devient la forme canonique `"1000"` ; une
valeur mal formée ou numériquement différente reste rejetée.
