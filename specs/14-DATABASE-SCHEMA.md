# Database Schema

## instruments

- id
- symbol
- provider_symbol
- exchange
- asset_class
- quote_currency
- exchange_timezone
- tick_size
- point_value
- quantity_step
- min_quantity
- contract_multiplier
- session_calendar_id
- risk_group
- active

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
- open_time
- close_time
- available_at
- open
- high
- low
- close
- volume
- is_closed

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
- requested_risk
- approved_quantity
- entry_reference_price
- stop_price
- reasons_json

## orders

- id
- signal_id
- risk_decision_id
- broker
- idempotency_key
- external_order_id
- side
- order_type
- quantity
- status
- created_at
- updated_at

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
- instrument_id
- side
- quantity
- average_entry_price
- protective_stop_price
- opened_at
- closed_at

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
