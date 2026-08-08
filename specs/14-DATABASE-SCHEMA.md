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

## strategy_capital_allocations

- id
- account_id
- strategy_version_id
- reference_currency (`EUR`)
- hard_cap_reference (`1000.00` maximum)
- allocated_equity_account_ccy
- effective_from
- effective_to

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
- evaluated_at
- decision
- requested_risk_account_ccy
- effective_capital_account_ccy
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
- dataset_id
- code_hash
- config_hash
- cost_model_version
- execution_model_version
- random_seed
- account_currency
- initial_capital
- hard_capital_cap_eur
- date_from
- date_to
- status
- metrics_json
- created_at

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
- `hard_cap_reference <= 1000.00`
- quantités positives et alignées sur `quantity_step`
- prix alignés sur `tick_size` avant soumission
- clés étrangères et contraintes d'unicité explicites pour fills, intents et snapshots
- `backtests.hard_capital_cap_eur <= 1000.00`
- unicité des fills au minimum sur `order_id + external_fill_id`
