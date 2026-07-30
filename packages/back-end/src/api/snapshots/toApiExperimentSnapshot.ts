import { ApiExperimentSnapshot } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getMetricAwareQueryStatus } from "back-end/src/queryRunners/QueryRunner";

/**
 * Build the `ExperimentSnapshot` public API model.
 *
 * Two endpoints return it, `GET /snapshots/{id}` and
 * `POST /experiments/{id}/snapshot`, so it is built here rather than inline in
 * each. The validator is `.strict()`, so the two hand-written literals it
 * replaced had to stay in lockstep with it and with each other.
 */
export function toApiExperimentSnapshot(
  snapshot: ExperimentSnapshotInterface,
): ApiExperimentSnapshot {
  return {
    id: snapshot.id,
    experiment: snapshot.experiment,
    status: snapshot.status,
    error: snapshot.error,
    // `status` cannot express a partial run: it is "success" whenever anything
    // analyzable survived. Absent for snapshots stored before queries recorded
    // the metrics they own, where completeness is genuinely unknowable.
    queryStatus: getMetricAwareQueryStatus(snapshot.queries) ?? undefined,
  };
}
