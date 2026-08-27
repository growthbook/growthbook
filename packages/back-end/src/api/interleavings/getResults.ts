import { getInterleavingResultsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadInterleavingForRead } from "./_shared";

export const getInterleavingResults = createApiRequestHandler(
  getInterleavingResultsValidator,
)(async (req) => {
  const { interleaving } = await loadInterleavingForRead(
    req.context,
    req.params.id,
  );
  const snapshot =
    await req.context.models.interleavingSnapshots.getLatestForInterleaving(
      interleaving.id,
    );
  return {
    snapshot: snapshot
      ? {
          id: snapshot.id,
          status: snapshot.status,
          error: snapshot.error,
          runStarted: snapshot.runStarted
            ? snapshot.runStarted.toISOString()
            : null,
          queries: snapshot.queries,
          metricEstimators: snapshot.metricEstimators,
          results: snapshot.results,
          dateCreated: snapshot.dateCreated.toISOString(),
        }
      : null,
  };
});
