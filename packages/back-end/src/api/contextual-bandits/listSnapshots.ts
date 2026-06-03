import { listCbSnapshotsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const listCbSnapshots = createApiRequestHandler(
  listCbSnapshotsValidator,
)(async (req) => {
  const { cb, experiment } = await loadCbForRead(req.context, req.params.id);
  if (!experiment) return { snapshots: [] };
  const phase = cb.phases.length - 1;
  const limit = req.query?.limit ?? 20;
  const snapshots =
    await req.context.models.contextualBanditSnapshots.listForExperiment(
      experiment.id,
      phase,
      limit,
    );
  return {
    snapshots: snapshots.map((s) => ({
      id: s.id,
      experiment: s.experiment,
      phase: s.phase,
      status: s.status,
      weightsWereUpdated: s.weightsWereUpdated,
      contextualBanditEventId: s.contextualBanditEventId,
      error: s.error,
      dateCreated: s.dateCreated.toISOString(),
    })),
  };
});
