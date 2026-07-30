import { ApiExperimentSnapshot } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";

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
  };
}
