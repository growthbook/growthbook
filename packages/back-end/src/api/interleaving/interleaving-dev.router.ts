// TEMPORARY dev-only routes for exercising interleaving analysis end to end
// (see src/scripts/seed-interleaving-demo.ts). There is no Interleaving
// experiment model yet, so `:id` is a free-form interleaving id that snapshots
// are keyed by. Remove this file and its line in api.router.ts before landing.
import { z } from "zod";
import { interleavingSnapshotSettingsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runInterleavingSnapshot } from "back-end/src/enterprise/services/interleavingAnalysis";

const paramsSchema = z.object({ id: z.string() }).strict();

const postInterleavingUpdate = createApiRequestHandler({
  paramsSchema,
  bodySchema: interleavingSnapshotSettingsValidator
    .omit({ interleavingId: true, datasourceId: true, query: true })
    .extend({
      startDate: z.coerce.date(),
      endDate: z.coerce.date().nullable().optional(),
    }),
  querySchema: z.never(),
  responseSchema: z.object({ snapshot: z.unknown() }),
  method: "post" as const,
  path: "/interleaving/:id/update",
  operationId: "devPostInterleavingUpdate",
  excludeFromSpec: true,
})(async (req) => ({
  snapshot: await runInterleavingSnapshot(req.context, {
    ...req.body,
    interleavingId: req.params.id,
  }),
}));

const getInterleavingSnapshot = createApiRequestHandler({
  paramsSchema,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({ snapshot: z.unknown() }),
  method: "get" as const,
  path: "/interleaving/:id/snapshot",
  operationId: "devGetInterleavingSnapshot",
  excludeFromSpec: true,
})(async (req) => {
  const snapshot =
    await req.context.models.interleavingSnapshots.getLatestForInterleaving(
      req.params.id,
    );
  if (!snapshot) {
    req.context.throwNotFoundError(
      `No snapshot found for interleaving ${req.params.id}`,
    );
  }
  return { snapshot };
});

export const interleavingDevRoutes = [
  postInterleavingUpdate,
  getInterleavingSnapshot,
];
