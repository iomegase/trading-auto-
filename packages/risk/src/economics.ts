import {
  asCurrencyCode,
  asDecimalString,
  createFuturesProduct,
  type CurrencyCode,
  type DecimalString,
  type FuturesProduct,
  type FuturesProductInput,
} from '@trading-auto/domain';
import { Decimal } from 'decimal.js';

import {
  MAX_RISK_DECIMAL_FRACTION_DIGITS,
  isRiskDecimalWithinBounds,
  riskDecimalFrom,
  riskDecimalToString,
} from './decimal.js';
import { RiskInputError, type RiskInputErrorCode } from './errors.js';
import {
  createCostModelSnapshot,
  createFxSnapshot,
  createMarginSnapshot,
  type CostModelSnapshot,
  type CostModelSnapshotInput,
  type FeeSchedule,
  type FeeScheduleInput,
  type FxSnapshot,
  type FxSnapshotInput,
  type MarginSnapshot,
  type MarginSnapshotInput,
} from './snapshots.js';

export interface CandidateEconomicsInput {
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly quantity: DecimalString;
  readonly product: Readonly<FuturesProduct>;
  readonly accountCurrency: CurrencyCode;
  readonly fx: Readonly<FxSnapshot> | null;
  readonly margin: Readonly<MarginSnapshot>;
  readonly costs: Readonly<CostModelSnapshot>;
}

export interface CandidateEconomics {
  readonly quantity: DecimalString;
  readonly directionalLossAccount: DecimalString;
  readonly estimatedCostsAccount: DecimalString;
  readonly worstCaseBudgetedLossAccount: DecimalString;
  readonly initialMarginAccount: DecimalString;
  readonly maintenanceMarginAccount: DecimalString;
  readonly grossExposureAccount: DecimalString;
}

type ObjectRecord = Record<string, unknown>;

const MAX_FEE_TIERS = 256;
const validationMetadata = Object.freeze({
  version: 'economics-validation-v1',
  source: '@trading-auto/risk',
  observedAt: '2000-01-01T00:00:00Z',
  validFrom: '2000-01-01T00:00:00Z',
  validUntil: '2100-01-01T00:00:00Z',
});
const validationZeroFees: FeeScheduleInput = Object.freeze({
  minimum: '0',
  tiers: Object.freeze([
    Object.freeze({ upToQuantity: null, feePerContract: '0' }),
  ]),
});

function fail(
  code: RiskInputErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new RiskInputError(code, message, details);
}

function invalid(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  fail('INVALID_RISK_INPUT', message, details);
}

function mismatchedCurrency(
  from: unknown,
  to: unknown,
  message = 'No FX snapshot can convert the required currency pair.',
): never {
  fail('MISMATCHED_CURRENCY', message, { from, to });
}

function assertObject(
  value: unknown,
  field: string,
): asserts value is ObjectRecord {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid(`${field} must be an object.`, { field });
    }
  } catch {
    invalid(`${field} must be an object.`, { field });
  }
}

function read(
  input: ObjectRecord,
  property: string,
  field = property,
): unknown {
  let descriptor: PropertyDescriptor | undefined;

  try {
    descriptor = Object.getOwnPropertyDescriptor(input, property);
  } catch {
    invalid(`${field} must be an own readable property.`, { field });
  }

  if (descriptor === undefined) {
    invalid(`${field} must be an own property.`, { field });
  }

  if ('value' in descriptor) {
    return descriptor.value;
  }

  if (descriptor.get === undefined) {
    return undefined;
  }

  try {
    return descriptor.get.call(input);
  } catch {
    invalid(`${field} must be readable.`, { field });
  }
}

function currency(value: unknown, field: string): CurrencyCode {
  try {
    return asCurrencyCode(value as string);
  } catch {
    invalid(`${field} must be a currency code.`, { field, value });
  }
}

function decimal(value: unknown, field: string): DecimalString {
  if (typeof value !== 'string') {
    invalid(`${field} must be a canonical finite decimal.`, { field, value });
  }

  if (!isRiskDecimalWithinBounds(value)) {
    invalid(`${field} exceeds the supported risk decimal bounds.`, {
      field,
      value,
    });
  }

  try {
    return asDecimalString(value);
  } catch {
    invalid(`${field} must be a canonical finite decimal.`, { field, value });
  }
}

function positiveDecimal(value: unknown, field: string): DecimalString {
  const validated = decimal(value, field);

  if (riskDecimalFrom(validated).lte(0)) {
    invalid(`${field} must be greater than zero.`, { field, value });
  }

  return validated;
}

function positiveInteger(value: unknown, field: string): DecimalString {
  const validated = positiveDecimal(value, field);

  if (!riskDecimalFrom(validated).isInteger()) {
    invalid(`${field} must be a positive integer.`, { field, value });
  }

  return riskDecimalToString(riskDecimalFrom(validated));
}

function boundedOutput(value: Decimal, field: string): DecimalString {
  const output = riskDecimalToString(value);

  if (!isRiskDecimalWithinBounds(output)) {
    invalid(`${field} exceeds the supported risk decimal bounds.`, {
      field,
    });
  }

  return output;
}

function roundPositiveConversion(value: Decimal): Decimal {
  // Every converted economics amount is nonnegative. Rounding away from zero
  // at the public scale therefore cannot understate risk, costs, or margin.
  return value.toDecimalPlaces(
    MAX_RISK_DECIMAL_FRACTION_DIGITS,
    Decimal.ROUND_UP,
  );
}

function validateWithFactory<T>(factory: () => T, field: string): T {
  try {
    return factory();
  } catch {
    invalid(`${field} is invalid.`, { field });
  }
}

function boundedRawDecimal(value: unknown, field: string): unknown {
  if (typeof value !== 'string' || !isRiskDecimalWithinBounds(value)) {
    invalid(`${field} exceeds the supported risk decimal bounds.`, {
      field,
      value,
    });
  }
  return value;
}

function validatedProduct(value: unknown): Readonly<FuturesProduct> {
  assertObject(value, 'product');
  const productInput = {
    productCode: read(value, 'productCode', 'product.productCode'),
    exchange: read(value, 'exchange', 'product.exchange'),
    underlyingId: read(value, 'underlyingId', 'product.underlyingId'),
    quoteCurrency: read(value, 'quoteCurrency', 'product.quoteCurrency'),
    pnlCurrency: read(value, 'pnlCurrency', 'product.pnlCurrency'),
    tickSize: boundedRawDecimal(
      read(value, 'tickSize', 'product.tickSize'),
      'product.tickSize',
    ),
    tickValue: boundedRawDecimal(
      read(value, 'tickValue', 'product.tickValue'),
      'product.tickValue',
    ),
    monetaryValuePerPriceUnit: boundedRawDecimal(
      read(
        value,
        'monetaryValuePerPriceUnit',
        'product.monetaryValuePerPriceUnit',
      ),
      'product.monetaryValuePerPriceUnit',
    ),
    quantityStep: boundedRawDecimal(
      read(value, 'quantityStep', 'product.quantityStep'),
      'product.quantityStep',
    ),
    minQuantity: boundedRawDecimal(
      read(value, 'minQuantity', 'product.minQuantity'),
      'product.minQuantity',
    ),
    riskGroup: read(value, 'riskGroup', 'product.riskGroup'),
  };

  return validateWithFactory(
    () => createFuturesProduct(productInput as FuturesProductInput),
    'product',
  );
}

function rawSnapshotMetadata(value: ObjectRecord, field: string) {
  return {
    version: read(value, 'version', `${field}.version`),
    source: read(value, 'source', `${field}.source`),
    observedAt: read(value, 'observedAt', `${field}.observedAt`),
    validFrom: read(value, 'validFrom', `${field}.validFrom`),
    validUntil: read(value, 'validUntil', `${field}.validUntil`),
  };
}

function validatedFx(value: unknown): Readonly<FxSnapshot> {
  assertObject(value, 'fx');
  const snapshotInput = {
    ...rawSnapshotMetadata(value, 'fx'),
    baseCurrency: read(value, 'baseCurrency', 'fx.baseCurrency'),
    quoteCurrency: read(value, 'quoteCurrency', 'fx.quoteCurrency'),
    rate: boundedRawDecimal(read(value, 'rate', 'fx.rate'), 'fx.rate'),
  };

  return validateWithFactory(
    () => createFxSnapshot(snapshotInput as FxSnapshotInput),
    'fx',
  );
}

function validatedMargin(value: unknown): Readonly<MarginSnapshot> {
  assertObject(value, 'margin');
  const marginInput = {
    ...rawSnapshotMetadata(value, 'margin'),
    contractId: read(value, 'contractId', 'margin.contractId'),
    currency: read(value, 'currency', 'margin.currency'),
    initialMarginPerContract: boundedRawDecimal(
      read(
        value,
        'initialMarginPerContract',
        'margin.initialMarginPerContract',
      ),
      'margin.initialMarginPerContract',
    ),
    maintenanceMarginPerContract: boundedRawDecimal(
      read(
        value,
        'maintenanceMarginPerContract',
        'margin.maintenanceMarginPerContract',
      ),
      'margin.maintenanceMarginPerContract',
    ),
  };

  return validateWithFactory(
    () => createMarginSnapshot(marginInput as MarginSnapshotInput),
    'margin',
  );
}

function denseArray(value: unknown, field: string): readonly unknown[] {
  let isArray: boolean;

  try {
    isArray = Array.isArray(value);
  } catch {
    invalid(`${field} must be a dense array.`, { field });
  }

  if (!isArray) {
    invalid(`${field} must be a dense array.`, { field });
  }

  const input = value as unknown[];
  const length = read(
    input as unknown as ObjectRecord,
    'length',
    `${field}.length`,
  );
  if (
    !Number.isSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > MAX_FEE_TIERS
  ) {
    invalid(`${field} has an unsupported length.`, {
      field,
      length,
      limit: MAX_FEE_TIERS,
    });
  }

  const items: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    items.push(
      read(
        input as unknown as ObjectRecord,
        String(index),
        `${field}[${String(index)}]`,
      ),
    );
  }

  return items;
}

function rawFeeSchedule(value: unknown, field: string): FeeScheduleInput {
  assertObject(value, field);
  const minimum = boundedRawDecimal(
    read(value, 'minimum', `${field}.minimum`),
    `${field}.minimum`,
  );
  const tiers = denseArray(
    read(value, 'tiers', `${field}.tiers`),
    `${field}.tiers`,
  );

  return {
    minimum: minimum as string,
    tiers: tiers.map((tierValue, index) => {
      const tierField = `${field}.tiers[${String(index)}]`;
      assertObject(tierValue, tierField);
      const upToQuantity = read(
        tierValue,
        'upToQuantity',
        `${tierField}.upToQuantity`,
      );

      return {
        upToQuantity:
          upToQuantity === null
            ? null
            : (boundedRawDecimal(
                upToQuantity,
                `${tierField}.upToQuantity`,
              ) as string),
        feePerContract: boundedRawDecimal(
          read(tierValue, 'feePerContract', `${tierField}.feePerContract`),
          `${tierField}.feePerContract`,
        ) as string,
      };
    }),
  };
}

function validatedCost(value: unknown): Readonly<CostModelSnapshot> {
  assertObject(value, 'costs');
  const costInput = {
    ...rawSnapshotMetadata(value, 'costs'),
    contractId: read(value, 'contractId', 'costs.contractId'),
    currency: read(value, 'currency', 'costs.currency'),
    entryFees: rawFeeSchedule(
      read(value, 'entryFees', 'costs.entryFees'),
      'costs.entryFees',
    ),
    exitFees: rawFeeSchedule(
      read(value, 'exitFees', 'costs.exitFees'),
      'costs.exitFees',
    ),
    spreadPriceUnitsRoundTrip: boundedRawDecimal(
      read(
        value,
        'spreadPriceUnitsRoundTrip',
        'costs.spreadPriceUnitsRoundTrip',
      ),
      'costs.spreadPriceUnitsRoundTrip',
    ),
    adverseEntrySlippagePriceUnits: boundedRawDecimal(
      read(
        value,
        'adverseEntrySlippagePriceUnits',
        'costs.adverseEntrySlippagePriceUnits',
      ),
      'costs.adverseEntrySlippagePriceUnits',
    ),
    adverseExitSlippagePriceUnits: boundedRawDecimal(
      read(
        value,
        'adverseExitSlippagePriceUnits',
        'costs.adverseExitSlippagePriceUnits',
      ),
      'costs.adverseExitSlippagePriceUnits',
    ),
  };

  return validateWithFactory(
    () => createCostModelSnapshot(costInput as CostModelSnapshotInput),
    'costs',
  );
}

function validatedFeeSchedule(value: unknown): Readonly<FeeSchedule> {
  const scheduleInput = rawFeeSchedule(value, 'schedule');
  return validateWithFactory(
    () =>
      createCostModelSnapshot({
        ...validationMetadata,
        contractId: 'ECONOMICS-VALIDATION',
        currency: 'EUR',
        entryFees: scheduleInput,
        exitFees: validationZeroFees,
        spreadPriceUnitsRoundTrip: '0',
        adverseEntrySlippagePriceUnits: '0',
        adverseExitSlippagePriceUnits: '0',
      }),
    'schedule',
  ).entryFees;
}

function resolveValidatedFxRate(
  from: CurrencyCode,
  to: CurrencyCode,
  snapshot: Readonly<FxSnapshot> | null,
): DecimalString {
  if (from === to) {
    return asDecimalString('1');
  }

  if (snapshot === null) {
    mismatchedCurrency(from, to);
  }

  if (snapshot.baseCurrency === from && snapshot.quoteCurrency === to) {
    return boundedOutput(riskDecimalFrom(snapshot.rate), 'fxRate');
  }

  if (snapshot.baseCurrency === to && snapshot.quoteCurrency === from) {
    return boundedOutput(
      roundPositiveConversion(
        riskDecimalFrom('1').div(riskDecimalFrom(snapshot.rate)),
      ),
      'fxRate',
    );
  }

  mismatchedCurrency(from, to);
}

export function resolveFxRate(
  from: CurrencyCode,
  to: CurrencyCode,
  snapshot: Readonly<FxSnapshot> | null,
): DecimalString {
  const validatedFrom = currency(from, 'from');
  const validatedTo = currency(to, 'to');

  if (validatedFrom === validatedTo) {
    if (snapshot !== null) {
      invalid('Identity FX conversion requires a null snapshot.', {
        from: validatedFrom,
        to: validatedTo,
      });
    }
    return asDecimalString('1');
  }

  return resolveValidatedFxRate(
    validatedFrom,
    validatedTo,
    snapshot === null ? null : validatedFx(snapshot),
  );
}

function calculateValidatedFee(
  quantity: DecimalString,
  schedule: Readonly<FeeSchedule>,
): DecimalString {
  const quantityValue = riskDecimalFrom(quantity);
  let remaining = quantityValue;
  let previousUpperBound = riskDecimalFrom('0');
  let total = riskDecimalFrom('0');

  for (const tier of schedule.tiers) {
    const availableInTier =
      tier.upToQuantity === null
        ? remaining
        : riskDecimalFrom(tier.upToQuantity).minus(previousUpperBound);
    const tierQuantity = remaining.lt(availableInTier)
      ? remaining
      : availableInTier;

    total = total.plus(
      tierQuantity.times(riskDecimalFrom(tier.feePerContract)),
    );
    remaining = remaining.minus(tierQuantity);

    if (tier.upToQuantity !== null) {
      previousUpperBound = riskDecimalFrom(tier.upToQuantity);
    }

    if (remaining.isZero()) {
      break;
    }
  }

  const minimum = riskDecimalFrom(schedule.minimum);
  return boundedOutput(total.lt(minimum) ? minimum : total, 'fee');
}

export function calculateFee(
  quantity: DecimalString,
  schedule: Readonly<FeeSchedule>,
): DecimalString {
  return calculateValidatedFee(
    positiveInteger(quantity, 'quantity'),
    validatedFeeSchedule(schedule),
  );
}

interface ValidatedCandidateInput {
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: DecimalString;
  readonly stopPrice: DecimalString;
  readonly quantity: DecimalString;
  readonly product: Readonly<FuturesProduct>;
  readonly accountCurrency: CurrencyCode;
  readonly fx: Readonly<FxSnapshot> | null;
  readonly margin: Readonly<MarginSnapshot>;
  readonly costs: Readonly<CostModelSnapshot>;
}

function validatedCandidateInput(value: unknown): ValidatedCandidateInput {
  assertObject(value, 'input');
  const direction = read(value, 'direction');

  if (direction !== 'LONG' && direction !== 'SHORT') {
    invalid('direction must be LONG or SHORT.', {
      field: 'direction',
      value: direction,
    });
  }

  const entryPrice = positiveDecimal(read(value, 'entryPrice'), 'entryPrice');
  const stopPrice = positiveDecimal(read(value, 'stopPrice'), 'stopPrice');
  const quantity = positiveInteger(read(value, 'quantity'), 'quantity');
  const product = validatedProduct(read(value, 'product'));
  const accountCurrency = currency(
    read(value, 'accountCurrency'),
    'accountCurrency',
  );
  const rawFx = read(value, 'fx');
  const margin = validatedMargin(read(value, 'margin'));
  const costs = validatedCost(read(value, 'costs'));

  if (margin.contractId !== costs.contractId) {
    fail(
      'MISMATCHED_CONTRACT',
      'Margin and cost snapshots must target the same contract.',
      {
        marginContractId: margin.contractId,
        costContractId: costs.contractId,
      },
    );
  }

  if (
    margin.currency !== product.pnlCurrency ||
    costs.currency !== product.pnlCurrency
  ) {
    fail(
      'MISMATCHED_CURRENCY',
      'Margin and cost currencies must equal the product P&L currency.',
      {
        pnlCurrency: product.pnlCurrency,
        marginCurrency: margin.currency,
        costCurrency: costs.currency,
      },
    );
  }

  const requiresFx = product.pnlCurrency !== accountCurrency;
  let fx: Readonly<FxSnapshot> | null = null;

  if (requiresFx) {
    if (rawFx === null) {
      mismatchedCurrency(product.pnlCurrency, accountCurrency);
    }
    fx = validatedFx(rawFx);
  } else if (rawFx !== null) {
    invalid('Identity economics requires a null FX snapshot.', {
      pnlCurrency: product.pnlCurrency,
      accountCurrency,
    });
  }

  return {
    direction,
    entryPrice,
    stopPrice,
    quantity,
    product,
    accountCurrency,
    fx,
    margin,
    costs,
  };
}

function assertPriceGridAndDirection(input: ValidatedCandidateInput): void {
  const entry = riskDecimalFrom(input.entryPrice);
  const stop = riskDecimalFrom(input.stopPrice);
  const tick = riskDecimalFrom(input.product.tickSize);

  if (!entry.mod(tick).isZero()) {
    invalid('entryPrice must align exactly to product.tickSize.', {
      field: 'entryPrice',
      value: input.entryPrice,
      tickSize: input.product.tickSize,
    });
  }
  if (!stop.mod(tick).isZero()) {
    invalid('stopPrice must align exactly to product.tickSize.', {
      field: 'stopPrice',
      value: input.stopPrice,
      tickSize: input.product.tickSize,
    });
  }

  if (input.direction === 'LONG' ? stop.gte(entry) : stop.lte(entry)) {
    invalid(
      input.direction === 'LONG'
        ? 'LONG stopPrice must be strictly below entryPrice.'
        : 'SHORT stopPrice must be strictly above entryPrice.',
      {
        direction: input.direction,
        entryPrice: input.entryPrice,
        stopPrice: input.stopPrice,
      },
    );
  }
}

function converted(
  amount: Decimal,
  from: CurrencyCode,
  input: ValidatedCandidateInput,
): Decimal {
  const rate = resolveValidatedFxRate(from, input.accountCurrency, input.fx);
  return roundPositiveConversion(amount.times(riskDecimalFrom(rate)));
}

export function calculateCandidateEconomics(
  input: CandidateEconomicsInput,
): CandidateEconomics {
  const validated = validatedCandidateInput(input);
  assertPriceGridAndDirection(validated);

  const entry = riskDecimalFrom(validated.entryPrice);
  const stop = riskDecimalFrom(validated.stopPrice);
  const quantity = riskDecimalFrom(validated.quantity);
  const monetaryValue = riskDecimalFrom(
    validated.product.monetaryValuePerPriceUnit,
  );
  const directionalLossPnl = entry
    .minus(stop)
    .abs()
    .times(monetaryValue)
    .times(quantity);
  const spreadAndSlippagePnl = riskDecimalFrom(
    validated.costs.spreadPriceUnitsRoundTrip,
  )
    .plus(riskDecimalFrom(validated.costs.adverseEntrySlippagePriceUnits))
    .plus(riskDecimalFrom(validated.costs.adverseExitSlippagePriceUnits))
    .times(monetaryValue)
    .times(quantity);
  const fees = riskDecimalFrom(
    calculateValidatedFee(validated.quantity, validated.costs.entryFees),
  ).plus(
    riskDecimalFrom(
      calculateValidatedFee(validated.quantity, validated.costs.exitFees),
    ),
  );
  const directionalLossAccount = converted(
    directionalLossPnl,
    validated.product.pnlCurrency,
    validated,
  );
  const spreadAndSlippageAccount = converted(
    spreadAndSlippagePnl,
    validated.product.pnlCurrency,
    validated,
  );
  const feesAccount = converted(fees, validated.costs.currency, validated);
  const estimatedCostsAccount = spreadAndSlippageAccount.plus(feesAccount);
  const initialMarginAccount = converted(
    riskDecimalFrom(validated.margin.initialMarginPerContract).times(quantity),
    validated.margin.currency,
    validated,
  );
  const maintenanceMarginAccount = converted(
    riskDecimalFrom(validated.margin.maintenanceMarginPerContract).times(
      quantity,
    ),
    validated.margin.currency,
    validated,
  );
  const grossExposureAccount = converted(
    entry.abs().times(monetaryValue).times(quantity),
    validated.product.pnlCurrency,
    validated,
  );

  return Object.freeze({
    quantity: validated.quantity,
    directionalLossAccount: boundedOutput(
      directionalLossAccount,
      'directionalLossAccount',
    ),
    estimatedCostsAccount: boundedOutput(
      estimatedCostsAccount,
      'estimatedCostsAccount',
    ),
    worstCaseBudgetedLossAccount: boundedOutput(
      directionalLossAccount.plus(estimatedCostsAccount),
      'worstCaseBudgetedLossAccount',
    ),
    initialMarginAccount: boundedOutput(
      initialMarginAccount,
      'initialMarginAccount',
    ),
    maintenanceMarginAccount: boundedOutput(
      maintenanceMarginAccount,
      'maintenanceMarginAccount',
    ),
    grossExposureAccount: boundedOutput(
      grossExposureAccount,
      'grossExposureAccount',
    ),
  });
}
