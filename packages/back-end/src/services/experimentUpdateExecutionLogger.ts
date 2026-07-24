import { DataSourceInterface } from "shared/types/datasource";
import {
  SnapshotTriggeredBy,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import type { CovariateInsertPathReason } from "back-end/src/integrations/sql/fact-metrics/resolve-covariate-insert-path";
import { SnapshotQueryRunnerKind } from "./experiments";

type ExperimentUpdateLogMeta = {
  experimentId: string;
  snapshotId: string;
  snapshotType: SnapshotType;
  triggeredBy: SnapshotTriggeredBy;
  datasource: DataSourceInterface;
};

export type ExperimentUpdateLogPlan = {
  runnerKind: SnapshotQueryRunnerKind;
  incrementalFallbackReason: string | null;
  useCache: boolean | null;
  fullRefresh: boolean | null;
  fullRefreshReason: string | null;
};

export type ExperimentUpdateCovariateSourceLog = {
  groupId: string;
  factTableId: string | null;
  path: "aggregated" | "legacy";
  aggregatedTableFullName: string | null;
  reason: CovariateInsertPathReason;
};

type ExperimentUpdateExecutionLog = {
  incrementalRefreshMode: "full" | "incremental" | null;
  // Per fact-table group: which covariate table the run used and why. null when
  // the run never resolved a covariate path (e.g. non-incremental runner kinds).
  covariateSources: ExperimentUpdateCovariateSourceLog[] | null;
};

type ExperimentUpdateTimingMs = {
  generateSql: number;
  runQueries: number;
  analyze: number;
  persistSnapshot: number;
  propagateSnapshot: number;
  total: number;
};

export type ExperimentUpdateTimingPhase = Exclude<
  keyof ExperimentUpdateTimingMs,
  "total"
>;

export class ExperimentUpdateExecutionLogger {
  public execution: ExperimentUpdateExecutionLog = {
    incrementalRefreshMode: null,
    covariateSources: null,
  };

  private readonly startedAtMs = Date.now();
  private totalMs: number | null = null;
  private readonly phaseStartedAtMs: Partial<
    Record<ExperimentUpdateTimingPhase, number>
  > = {};
  private readonly phaseMs = {
    generateSql: 0,
    runQueries: 0,
    analyze: 0,
    persistSnapshot: 0,
    propagateSnapshot: 0,
  };
  private logged = false;

  constructor(
    public readonly plan: ExperimentUpdateLogPlan,
    private readonly meta: ExperimentUpdateLogMeta,
  ) {}

  async withTiming<T>(
    phase: ExperimentUpdateTimingPhase,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    this.startPhase(phase);
    try {
      return await fn();
    } finally {
      this.endPhase(phase);
    }
  }

  startPhase(phase: ExperimentUpdateTimingPhase): void {
    if (this.phaseStartedAtMs[phase] !== undefined) {
      return;
    }
    this.phaseStartedAtMs[phase] = Date.now();
  }

  endPhase(phase: ExperimentUpdateTimingPhase): void {
    const startedAt = this.phaseStartedAtMs[phase];
    if (startedAt !== undefined) {
      this.phaseMs[phase] += Date.now() - startedAt;
      delete this.phaseStartedAtMs[phase];
    }

    if (phase === "propagateSnapshot") {
      this.freezeTotal();
    }
  }

  private freezeTotal(): void {
    if (this.totalMs !== null) {
      return;
    }
    this.totalMs = Date.now() - this.startedAtMs;
  }

  getTimings(): ExperimentUpdateTimingMs {
    return {
      ...this.phaseMs,
      total: this.totalMs ?? 0,
    };
  }

  recordCovariateSource(entry: ExperimentUpdateCovariateSourceLog): void {
    (this.execution.covariateSources ??= []).push(entry);
  }

  logUpdateCompleted(
    context: ReqContext | ApiReqContext,
    {
      snapshotStatus,
      error,
    }: {
      snapshotStatus: "running" | "success" | "error";
      error?: string;
    },
  ): void {
    if (this.logged || snapshotStatus === "running") {
      return;
    }
    this.logged = true;
    this.freezeTotal();
    context.logger.info(
      {
        event: "experiment_updated",
        experimentId: this.meta.experimentId,
        snapshotId: this.meta.snapshotId,
        snapshotType: this.meta.snapshotType,
        triggeredBy: this.meta.triggeredBy,
        snapshotStatus,
        error: error || null,
        datasourceId: this.meta.datasource.id,
        datasourceType: this.meta.datasource.type,
        runnerKind: this.plan.runnerKind,
        incrementalFallbackReason: this.plan.incrementalFallbackReason,
        plannedFullRefresh: this.plan.fullRefresh,
        fullRefreshReason: this.plan.fullRefreshReason,
        incrementalRefreshMode: this.execution.incrementalRefreshMode,
        covariateSources: this.execution.covariateSources,
        timingsMs: this.getTimings(),
      },
      "Experiment update completed",
    );
  }
}
