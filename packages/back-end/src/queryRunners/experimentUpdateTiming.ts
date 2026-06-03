import { ExperimentUpdateExecutionLogger } from "back-end/src/services/experimentUpdateExecutionLogger";

export function onGenerateQueriesStart(
  logger: ExperimentUpdateExecutionLogger | null,
): void {
  logger?.startPhase("generateSql");
}

export function onGenerateQueriesEnd(
  logger: ExperimentUpdateExecutionLogger | null,
): void {
  logger?.endPhase("generateSql");
}

export function onRunQueriesStart(
  logger: ExperimentUpdateExecutionLogger | null,
): void {
  logger?.startPhase("runQueries");
}

export function onRunQueriesEnd(
  logger: ExperimentUpdateExecutionLogger | null,
): void {
  logger?.endPhase("runQueries");
}

export function onRunAnalysisStart(
  logger: ExperimentUpdateExecutionLogger | null,
): void {
  logger?.startPhase("analyze");
}

export function onRunAnalysisEnd(
  logger: ExperimentUpdateExecutionLogger | null,
): void {
  logger?.endPhase("analyze");
}
