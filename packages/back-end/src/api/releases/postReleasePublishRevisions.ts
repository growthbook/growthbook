import { z } from "zod";
import {
  postReleasePublishRevisionsValidator,
  publishRevisionsItem,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
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
  BulkPublishPlan,
} from "back-end/src/revisions/bulkPublish/types";

// The union member shapes are disjoint per entity type; widen to one optional
// bag so the resolution loop below can read fields without narrowing per arm.
type RequestRevisionItem = Pick<
  z.infer<typeof publishRevisionsItem>,
  "entityType"
> & {
  id?: string;
  key?: string;
  version?: number;
  revisionId?: string;
};

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
    let callerId = item.key ?? item.id ?? "";
    let entityId = callerId;
    let version = item.version ?? 0;

    if (item.revisionId !== undefined) {
      if (item.entityType === "feature") {
        // Tuple-shaped (legacy) ids decode locally; minted opaque ids resolve
        // via the sparse (organization, id) index. An unknown id flows into
        // the plan's not-found gate rather than failing the request shape.
        const coords =
          parseFeatureRevisionId(item.revisionId) ??
          (await findFeatureRevisionCoordinatesByRevisionId(
            req.organization.id,
            item.revisionId,
          ));
        if (coords) {
          callerId = coords.featureId;
          entityId = coords.featureId;
          version = coords.version;
        } else {
          callerId = item.revisionId;
          entityId = item.revisionId;
        }
      } else {
        const revision = await req.context.models.revisions.getById(
          item.revisionId,
        );
        if (revision && revision.target.type !== item.entityType) {
          throw new BadRequestError(
            `Revision "${item.revisionId}" belongs to a ${revision.target.type}, not a ${item.entityType}`,
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
        } else {
          // Unknown id: let the plan report it as a not-found gate rather
          // than failing the whole request shape.
          callerId = item.revisionId;
          entityId = item.revisionId;
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

  const result = await commitBulkPublish(req.context, plan);

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
