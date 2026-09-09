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
  isFeatureRevisionId,
  parseFeatureRevisionId,
  getActiveDraft,
} from "back-end/src/models/FeatureRevisionModel";
import { PublishBlockedError } from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  assertFeatureNotManaged,
  getManagedFeatureForExperiment,
} from "back-end/src/services/managedFeatures";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
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
  field: "id" | "key" | "version" | "revisionId" | "experimentId",
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
  // Managed flags publish as ordinary feature revisions but are addressed, and
  // answered, as their experiment.
  const managedByInternal = new Map<
    string,
    { experimentId: string; featureId: string; version: number }
  >();
  for (const item of req.body.revisions as RequestRevisionItem[]) {
    if (item.entityType === "managed-feature") {
      const experiment = await getExperimentById(
        req.context,
        item.experimentId,
      );
      if (!experiment) {
        throw new BadRequestError(
          `Experiment "${item.experimentId}" not found`,
        );
      }
      if (!req.context.permissions.canUpdateExperiment(experiment, {})) {
        req.context.permissions.throwPermissionError();
      }
      const feature = await getManagedFeatureForExperiment(
        req.context,
        experiment,
      );
      if (!feature) {
        throw new BadRequestError(
          `Experiment "${experiment.id}" does not manage a Feature Flag`,
        );
      }
      if (experiment.status === "draft") {
        throw new BadRequestError(
          `Experiment "${experiment.id}" has not started; its pending variation values publish when it starts`,
        );
      }
      const draft = await getActiveDraft(req.context, feature);
      if (!draft) {
        throw new BadRequestError(
          `Experiment "${experiment.id}" has no pending variation values`,
        );
      }
      const version = item.version ?? draft.version;
      callerIdByInternal.set(`feature:${feature.id}`, experiment.id);
      managedByInternal.set(`feature:${feature.id}`, {
        experimentId: experiment.id,
        featureId: feature.id,
        version,
      });
      refs.push({
        entityType: "feature",
        entityId: feature.id,
        version,
        displayId: experiment.id,
      });
      continue;
    }
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
      // Feature revision ids are `frev_…`; generic (config/constant/saved-
      // group) revision ids are `rev_…`. Reject a shape/entityType mismatch
      // up front with a clear 400 — otherwise a `frev_` sent with a generic
      // entityType (or vice versa) silently misses its model and degrades to a
      // confusing "not found" gate for an id that does exist.
      const isFeatureShape = isFeatureRevisionId(revisionId);
      if (isFeatureShape !== (item.entityType === "feature")) {
        throw new BadRequestError(
          `Revision id "${revisionId}" is ${
            isFeatureShape ? "a Feature Flag" : "a generic"
          } revision id, which does not match entityType "${item.entityType}"`,
        );
      }
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

    // This endpoint addresses features by body, not by URL param, so the
    // route-level managed guard cannot see it. Both id shapes land here.
    if (item.entityType === "feature") {
      await assertFeatureNotManaged(req.context, entityId, "rest");
    }

    callerIdByInternal.set(`${item.entityType}:${entityId}`, callerId);
    refs.push({
      entityType: item.entityType,
      entityId,
      version,
      displayId: callerId,
    });
  }

  const callerIdFor = (entityType: string, entityId: string) =>
    callerIdByInternal.get(`${entityType}:${entityId}`) ?? entityId;
  const callerTypeFor = (
    entityType: BulkPublishItemRef["entityType"],
    entityId: string,
  ): BulkPublishItemRef["entityType"] | "managed-feature" =>
    managedByInternal.has(`${entityType}:${entityId}`)
      ? "managed-feature"
      : entityType;
  // A managed flag's own routes refuse writes, so its gates must point at the
  // experiment's routes instead. Actions without a counterpart there get none.
  const managedResolution = (
    managed: { experimentId: string },
    resolution: BulkPublishGate["resolution"],
  ): BulkPublishGate["resolution"] => {
    if (!resolution) return null;
    if (!["rebase", "request-review"].includes(resolution.action)) return null;
    return {
      ...resolution,
      path: `/experiments/${managed.experimentId}/variation-values/${resolution.action}`,
    };
  };

  // One flat result-item shape for every response surface (dry-run, success,
  // and the commit-error body) — `id` speaks the caller's identifier, never
  // the internal entityId.
  const toResponseItem = <S extends string>(
    ref: BulkPublishItemRef,
    revisionId: string,
    status: S,
  ) => ({
    entityType: callerTypeFor(ref.entityType, ref.entityId),
    id: callerIdFor(ref.entityType, ref.entityId),
    version: ref.version,
    revisionId,
    status,
  });

  // Spread the gate so a PublishGate field change flows through untouched;
  // only the internal entityId is swapped for the caller's identifier.
  const serializeGate = ({ entityId, ...gate }: BulkPublishGate) => {
    const managed = managedByInternal.get(`${gate.entityType}:${entityId}`);
    return {
      ...gate,
      entityType: callerTypeFor(gate.entityType, entityId),
      id: callerIdFor(gate.entityType, entityId),
      resolution: managed
        ? managedResolution(managed, gate.resolution)
        : gate.resolution,
    };
  };

  const serializeBypassed = (plan: BulkPublishPlan) =>
    plan.items.flatMap((item) =>
      item.bypassedGates.map((gate) => ({
        entityType: callerTypeFor(item.ref.entityType, item.ref.entityId),
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
      results: plan.items.map((item) =>
        toResponseItem(item.ref, item.revision.id, "would-publish"),
      ),
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
        (e.items as BulkPublishItemResult[]).map((item) =>
          toResponseItem(item.ref, item.revisionId, item.status),
        ),
      );
    }
    throw e;
  }

  return {
    dryRun: false,
    bulkPublishId: result.bulkPublishId,
    results: result.items.map((item) =>
      toResponseItem(item.ref, item.revisionId, "published"),
    ),
    gates: [],
    bypassedGates: serializeBypassed(plan),
    warnings: result.warnings,
  };
});
