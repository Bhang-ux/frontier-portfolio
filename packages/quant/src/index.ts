/**
 * @frontier/quant — the quantitative engine behind Frontier.
 *
 * Pure TypeScript, zero runtime dependencies, deterministic. The same code
 * runs in the data pipeline (Node, GitHub Actions), in the browser main
 * thread, and inside the analytics Web Worker.
 */
export * from './random';
export * from './linalg';
export * from './stats';
export * from './series';
export * from './metrics';
export * from './covariance';
export * from './expected';
export * from './risk';
export * from './optimize';
export * from './montecarlo';
export * from './backtest';
export * from './signals';
export * from './hmm';
export * from './factors';
export * from './stress';
export * from './rebalance';
export * from './health';
export * as explain from './explain';
