import { DataSourceInterface } from "shared/types/datasource";
import {
  ExperimentSnapshotInterface,
  SnapshotQueryRunnerKind,
} from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import type { CovariateInsertPathReason } from "back-end/src/integrations/sql/fact-metrics/resolve-covariate-insert-path";
import type { RecoveryDeclineReason } from "back-end/src/queryRunners/rehydrate";

type ExperimentUpdateLogMeta = {
  datasource: DataSourceInterface;
  // The live runner or a stalled-snapshot recovery replaying its results.
  concludedBy: "runner" | "recovery";
};

export type SnapshotReapReason =
  | "stale-queries"
  | "orphaned"
  | "not-finalized"
  | `recovery-declined:${RecoveryDeclineReason}`
  | "recovery-failed";

/** Who moved a snapshot out of "running", and for the reaper, why. */
export type SnapshotConclusion =
  | { concludedBy: "runner" | "recovery" | "cancel" }
  | { concludedBy: "reaper"; reason: SnapshotReapReason };

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

  get concludedBy(): ExperimentUpdateLogMeta["concludedBy"] {
    return this.meta.concludedBy;
  }

  get datasourceType(): DataSourceInterface["type"] {
    return this.meta.datasource.type;
  }

  /** Stops the total clock and returns the phase timings. */
  completedTimings(): ExperimentUpdateTimingMs {
    this.freezeTotal();
    return this.getTimings();
  }
}

/**
 * One line per snapshot each time it leaves "running", whoever moved it there.
 * Run timings exist only when the runner or a recovery measured them.
 */
export function logExperimentUpdated(
  context: Context,
  {
    snapshot,
    snapshotStatus,
    conclusion,
    executionLogger,
  }: {
    snapshot: ExperimentSnapshotInterface;
    snapshotStatus: "success" | "error" | "deleted";
    conclusion: SnapshotConclusion;
    executionLogger: ExperimentUpdateExecutionLogger | null;
  },
): void {
  const timings = executionLogger?.completedTimings() ?? null;
  context.logger.info(
    {
      event: "experiment_updated",
      organization: snapshot.organization,
      experimentId: snapshot.experiment,
      snapshotId: snapshot.id,
      snapshotType: snapshot.type,
      triggeredBy: snapshot.triggeredBy ?? null,
      snapshotStatus,
      concludedBy: conclusion.concludedBy,
      reason: conclusion.concludedBy === "reaper" ? conclusion.reason : null,
      error: snapshot.error || null,
      datasourceId: snapshot.settings.datasourceId,
      datasourceType: executionLogger?.datasourceType ?? null,
      runnerKind:
        executionLogger?.plan.runnerKind ?? snapshot.runnerKind ?? null,
      incrementalFallbackReason:
        executionLogger?.plan.incrementalFallbackReason ?? null,
      plannedFullRefresh: executionLogger?.plan.fullRefresh ?? null,
      fullRefreshReason: executionLogger?.plan.fullRefreshReason ?? null,
      incrementalRefreshMode:
        executionLogger?.execution.incrementalRefreshMode ?? null,
      covariateSources: executionLogger?.execution.covariateSources ?? null,
      timingsMs: {
        generateSql: timings?.generateSql ?? null,
        runQueries: timings?.runQueries ?? null,
        analyze: timings?.analyze ?? null,
        persistSnapshot: timings?.persistSnapshot ?? null,
        propagateSnapshot: timings?.propagateSnapshot ?? null,
        total: timings?.total ?? null,
        snapshotAge: Date.now() - snapshot.dateCreated.getTime(),
      },
    },
    "Experiment update completed",
  );
}
