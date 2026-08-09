import type { InstantString } from './time.js';

export interface DecisionContext {
  readonly decisionAt: InstantString;
  readonly signalCandleCloseTime: InstantString;
  readonly trendCandleCloseTime: InstantString;
  readonly datasetVersion: string;
  readonly strategyVersion: string;
}
