// TEMPORARY dev-only routes for exercising interleaving analysis end to end
// (see src/scripts/seed-interleaving-demo.ts). The Interleaving model has no
// REST API yet, so this exposes create + run + latest snapshot. Remove this
// file and its line in api.router.ts before landing.
import { z } from "zod";
import { interleavingValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runInterleavingSnapshot } from "back-end/src/enterprise/services/interleavingAnalysis";

const paramsSchema = z.object({ id: z.string() }).strict();

const postInterleaving = createApiRequestHandler({
  paramsSchema: z.never(),
  bodySchema: interleavingValidator
    .omit({
      id: true,
      organization: true,
      dateCreated: true,
      dateUpdated: true,
      dateStarted: true,
      dateStopped: true,
    })
    .extend({
      dateStarted: z.coerce.date().optional(),
      dateStopped: z.coerce.date().optional(),
    }),
  querySchema: z.never(),
  responseSchema: z.object({ interleaving: z.unknown() }),
  method: "post" as const,
  path: "/interleaving",
  operationId: "devPostInterleaving",
  excludeFromSpec: true,
})(async (req) => ({
  interleaving: await req.context.models.interleavings.create(req.body),
}));

const postInterleavingUpdate = createApiRequestHandler({
  paramsSchema,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({ snapshot: z.unknown() }),
  method: "post" as const,
  path: "/interleaving/:id/update",
  operationId: "devPostInterleavingUpdate",
  excludeFromSpec: true,
})(async (req) => ({
  snapshot: await runInterleavingSnapshot(req.context, req.params.id),
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
  postInterleaving,
  postInterleavingUpdate,
  getInterleavingSnapshot,
];
