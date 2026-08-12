import { type DecimalString } from '@trading-auto/domain';

import { riskDecimalFrom, riskDecimalToString } from './decimal.js';
import { createRiskAccountState, type RiskAccountState } from './portfolio.js';
import { createRiskPolicy, type RiskPolicyVersion } from './policy.js';

export function calculateSizingEquity(
  account: Readonly<RiskAccountState>,
  policy: Readonly<RiskPolicyVersion>,
): DecimalString {
  const validatedAccount = createRiskAccountState(account);
  const validatedPolicy = createRiskPolicy(policy);
  const unrealizedLoss = riskDecimalFrom(validatedAccount.unrealizedPnl).lt(0)
    ? riskDecimalFrom(validatedAccount.unrealizedPnl)
    : riskDecimalFrom('0');
  const asymmetric = riskDecimalFrom(validatedAccount.realizedEquity).plus(
    unrealizedLoss,
  );
  const nonNegative = asymmetric.lt(0) ? riskDecimalFrom('0') : asymmetric;
  const cap = riskDecimalFrom(validatedPolicy.maxSizingCapital);
  return riskDecimalToString(nonNegative.gt(cap) ? cap : nonNegative);
}
