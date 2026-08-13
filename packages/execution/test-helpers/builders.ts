import type { FuturesContract, FuturesProduct } from '@trading-auto/domain';

import {
  createExecutionSchedule,
  createH1OpenEvent,
  type ExecutionScheduleInput,
  type H1OpenEventInput,
} from '../src/index.js';

export function buildExecutionSchedule(
  contract: Readonly<FuturesContract>,
  overrides: Partial<ExecutionScheduleInput> = {},
) {
  return createExecutionSchedule({
    version: `${contract.contractId}_SESSION_V1`,
    source: 'SYNTHETIC_EXCHANGE_CALENDAR',
    observedAt: '2026-01-02T07:00:00Z',
    validFrom: '2026-01-02T08:00:00Z',
    validUntil: '2026-01-02T18:00:00Z',
    contractId: contract.contractId,
    tradableIntervals: [
      { start: '2026-01-02T08:00:00Z', end: '2026-01-02T18:00:00Z' },
    ],
    maintenanceBreaks: [],
    ...overrides,
  });
}

export function buildExecutionOpen(
  product: Readonly<FuturesProduct>,
  contract: Readonly<FuturesContract>,
  openTime: string,
  overrides: Partial<H1OpenEventInput> = {},
) {
  return createH1OpenEvent({
    instrumentId: product.productCode,
    contractId: contract.contractId,
    openTime,
    availableAt: openTime,
    price: '100',
    ...overrides,
  });
}
