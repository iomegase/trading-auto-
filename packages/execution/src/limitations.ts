export type ExecutionLimitation =
  'NO_INTRABAR_PATH' | 'NO_PARTIAL_FILLS' | 'NO_ORDER_BOOK';

export const executionLimitations: readonly ExecutionLimitation[] =
  Object.freeze(['NO_INTRABAR_PATH', 'NO_PARTIAL_FILLS', 'NO_ORDER_BOOK']);
