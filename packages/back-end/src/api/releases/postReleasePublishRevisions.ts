import { z } from "zod";
import {
  postReleasePublishRevisionsValidator,
  publishRevisionsItem,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  BulkPublishCommitError,
  PlanDoesNotAllowError,
} from "back-end/src/util/errors";
import {
  findFeatureRevisionCoordinatesByRevisionId,
  parseFeatureRevisionId,
} from "back-end/src/models/FeatureRevisionModel";
import { PublishBlockedError } from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  commitBulkPublish,
  planBulkPublish,
} from "back-end/src/revisions/bulkPublish/bulkPublish";
import type {
  BulkPublishGate,
  BulkPublishItemRef,
  BulkPublishItemResult,
  BulkPublishPlan,
} from "back-end/src/revisions/bulkPublish/types";

type RequestRevisionItem = z.infer<typeof publishRevisionsItem>;

// The union arms are strict and disjoint, so plain `in` checks narrow them.
const itemField = (
  item: RequestRevisionItem,
  field: "id" | "key" | "version" | "revisionId",
): string | number | undefined =>
  field in item
    ? (item as unknown as Record<typeof field, string | number>)[field]
    : undefined;

export const postReleasePublishRevisions = createApiRequestHandler(
  postReleasePublishRevisionsValidator,
)(async (req) => {
  if (!req.context.hasPremiumFeature("releases")) {
    throw new PlanDoesNotAllowError(
      "Your plan does not include the Releases feature",
    );
  }

  // Resolve request identifiers (configs/constants go by key on the REST API,
  // revisions target internal ids; the revisionId form decodes to the same
  // coordinates) and remember the mapping so every response shape speaks the
  // caller's identifiers.
  const refs: BulkPublishItemRef[] = [];
  const callerIdByInternal = new Map<string, string>();
  for (const item of req.body.revisions as RequestRevisionItem[]) {
    const revisionId = itemField(item, "revisionId") as string | undefined;
    // Seed with whichever identifier the union arm carries — an unresolvable
    // revisionId flows into the plan's not-found gate rather than failing the
    // request shape.
    let callerId = String(
      itemField(item, "key") ?? itemField(item, "id") ?? revisionId ?? "",
    );
    let entityId = callerId;
    let version = Number(itemField(item, "version") ?? 0);

    if (revisionId !== undefined) {
      if (item.entityType === "feature") {
        // Tuple-shaped (legacy) ids decode locally; minted opaque ids resolve
        // via the sparse (organization, id) index.
        const coords =
          parseFeatureRevisionId(revisionId) ??
          (await findFeatureRevisionCoordinatesByRevisionId(
            req.organization.id,
            revisionId,
          ));
        if (coords) {
          callerId = coords.featureId;
          entityId = coords.featureId;
          version = coords.version;
        }
      } else {
        const revision = await req.context.models.revisions.getById(revisionId);
        if (revision && revision.target.type !== item.entityType) {
          throw new BadRequestError(
            `Revision "${revisionId}" belongs to a ${revision.target.type}, not a ${item.entityType}`,
          );
        }
        if (revision) {
          entityId = revision.target.id;
          version = revision.version ?? 0;
          // Response identifiers: configs/constants speak keys on this API.
          const model =
            item.entityType === "config"
              ? req.context.models.configs
              : item.entityType === "constant"
                ? req.context.models.constants
                : null;
          const entity = await model?.getById(entityId);
          callerId = entity?.key ?? entityId;
        }
      }
    } else if (item.entityType === "config") {
      const config = await req.context.models.configs.getByKey(callerId);
      if (config) entityId = config.id;
    } else if (item.entityType === "constant") {
      const constant = await req.context.models.constants.getByKey(callerId);
      if (constant) entityId = constant.id;
    }

    callerIdByInternal.set(`${item.entityType}:${entityId}`, callerId);
    refs.push({ entityType: item.entityType, entityId, version });
  }

  const callerIdFor = (entityType: string, entityId: string) =>
    callerIdByInternal.get(`${entityType}:${entityId}`) ?? entityId;

  const serializeGate = (gate: BulkPublishGate) => ({
    entityType: gate.entityType,
    id: callerIdFor(gate.entityType, gate.entityId),
    version: gate.version,
    type: gate.type,
    severity: gate.severity,
    messages: gate.messages,
    override: gate.override,
    requiresPermission: gate.requiresPermission,
    resolution: gate.resolution,
  });

  const serializeBypassed = (plan: BulkPublishPlan) =>
    plan.items.flatMap((item) =>
      item.bypassedGates.map((gate) => ({
        entityType: item.ref.entityType,
        id: callerIdFor(item.ref.entityType, item.ref.entityId),
        version: item.ref.version,
        type: gate.type,
        via: gate.via,
      })),
    );

  const plan = await planBulkPublish(req.context, refs, {
    ignoreWarnings: req.body.ignoreWarnings === true,
    skipSchemaValidation: req.body.skipSchemaValidation === true,
    skipHooks: req.body.skipHooks === true,
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
    comment: req.body.comment,
  });

  if (req.body.dryRun) {
    return {
      dryRun: true,
      results: plan.items.map((item) => ({
        entityType: item.ref.entityType,
        id: callerIdFor(item.ref.entityType, item.ref.entityId),
        version: item.ref.version,
        revisionId: item.revision.id,
        status: "would-publish" as const,
      })),
      gates: plan.gates.map(serializeGate),
      bypassedGates: serializeBypassed(plan),
      warnings: plan.warnings,
    };
  }

  if (plan.blockingGates.length) {
    throw new PublishBlockedError(plan.blockingGates.map(serializeGate));
  }

  let result;
  try {
    result = await commitBulkPublish(req.context, plan);
  } catch (e) {
    // The 500 body's per-item outcomes must speak the caller's identifier
    // vocabulary (flat `id` with keys), like every other response surface.
    if (e instanceof BulkPublishCommitError) {
      throw new BulkPublishCommitError(
        e.message,
        (e.items as BulkPublishItemResult[]).map((item) => ({
          entityType: item.ref.entityType,
          id: callerIdFor(item.ref.entityType, item.ref.entityId),
          version: item.ref.version,
          revisionId: item.revisionId,
          status: item.status,
        })),
      );
    }
    throw e;
  }

  return {
    dryRun: false,
    bulkPublishId: result.bulkPublishId,
    results: result.items.map((item) => ({
      entityType: item.ref.entityType,
      id: callerIdFor(item.ref.entityType, item.ref.entityId),
      version: item.ref.version,
      revisionId: item.revisionId,
      status: "published" as const,
    })),
    gates: [],
    bypassedGates: serializeBypassed(plan),
    warnings: result.warnings,
  };
});
