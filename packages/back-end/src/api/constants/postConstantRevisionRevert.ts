import { isEqual } from "lodash";
import { JsonPatchOperation, Revision } from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import {
  postConstantRevisionRevertValidator,
  constantUpdatableFieldsSchema,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  applyPatchToSnapshot,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRevert = createApiRequestHandler(
  postConstantRevisionRevertValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const adapter = getAdapter("constant");
  if (!adapter.canUpdate(req.context, constant as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  const targetRevision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  if (targetRevision.status !== "merged") {
    throw new BadRequestError(
      "Can only revert to a published (merged) revision. " +
        `Revision #${req.params.version} has status "${targetRevision.status}".`,
    );
  }

  // Reconstruct the constant's state at the time of the historical revision
  // (base snapshot + its proposed changes = post-merge state).
  const targetState = applyPatchToSnapshot(
    targetRevision.target.snapshot as ConstantInterface,
    targetRevision.target.proposedChanges,
  ) as ConstantInterface;

  // Diff vs the current live constant; omit fields equal to live.
  const fieldsToUpdate: Record<string, unknown> = {};
  for (const field of Object.keys(constantUpdatableFieldsSchema.shape)) {
    const targetValue = (targetState as Record<string, unknown>)[field];
    const liveValue = (constant as unknown as Record<string, unknown>)[field];
    if (targetValue !== undefined && !isEqual(targetValue, liveValue)) {
      fieldsToUpdate[field] = targetValue;
    }
  }

  // Full-map-replace clear for per-env overrides: when the target revision had
  // NO `environmentValues` (undefined/absent) but the live constant currently
  // has overrides, reverting must CLEAR them so the live state matches the
  // target. The generic loop above skips `undefined` target values, so handle
  // this explicitly by replacing with an empty map. (Mirrors the per-env
  // default-value full-map-replace semantics on features.)
  const targetEnvValues = (targetState as Record<string, unknown>)
    .environmentValues;
  const liveEnvValues = (constant as unknown as Record<string, unknown>)
    .environmentValues as Record<string, unknown> | undefined;
  if (
    targetEnvValues === undefined &&
    liveEnvValues !== undefined &&
    Object.keys(liveEnvValues).length > 0
  ) {
    fieldsToUpdate.environmentValues = {};
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new BadRequestError(
      `Revision #${req.params.version} matches the current constant — nothing to revert.`,
    );
  }

  const revertsBypassApproval =
    !!req.organization.settings?.revertsBypassApproval;
  const strategy =
    req.body.strategy ?? (revertsBypassApproval ? "publish" : "draft");
  const isPublish = strategy === "publish";

  const patchOps: JsonPatchOperation[] = Object.entries(fieldsToUpdate).map(
    ([key, value]) => ({ op: "replace" as const, path: `/${key}`, value }),
  );

  // For publish, mirror the publish handler's per-revision approval gate. The
  // constant adapter reads target.snapshot for the project + change diff, so
  // include the live constant as the snapshot (unlike the saved-group handler,
  // whose adapter ignores the snapshot here).
  let approvalRequired = false;
  let canBypass = false;
  if (isPublish) {
    approvalRequired = revertsBypassApproval
      ? false
      : adapter.isApprovalRequiredForRevision
        ? adapter.isApprovalRequiredForRevision(req.context, {
            target: { snapshot: constant, proposedChanges: patchOps },
          } as unknown as Revision)
        : adapter.isApprovalRequired(req.context);
    canBypass =
      !!req.organization.settings?.restApiBypassesReviews ||
      adapter.canBypassApproval(
        req.context,
        constant as Record<string, unknown>,
      );
    if (approvalRequired && !canBypass) {
      throw new BadRequestError(
        "This revert requires approval before changes can be published. " +
          'Use `strategy: "draft"` to create a draft for review, ' +
          "or use a role/token that grants bypassApprovalChecks.",
      );
    }
  }

  await ensureLiveRevisionExists(
    req.context,
    "constant",
    constant as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  const title = req.body.title ?? `Revert to v${req.params.version}`;

  if (!isPublish) {
    const draft = await createOrUpdateRevision(
      req.context,
      "constant",
      constant as unknown as Record<string, unknown> & { id: string },
      patchOps,
      { forceCreate: true, title, revertedFrom: targetRevision.id },
    );
    await dispatchConstantRevisionEvent(req.context, draft, {
      type: "created",
    });
    return { revision: await toApiConstantRevision(draft, req.context) };
  }

  // Record the already-merged revert revision FIRST, then apply it to the live
  // entity. If the apply fails, delete the just-created revision so we never
  // leave a "reverted" record with no corresponding live change. (There's no
  // concurrent-discard vector here — the revision is created in its terminal
  // `merged` state — so this is a clean abort rather than a claim-then-CAS.)
  const merged = await req.context.models.revisions.createMerged({
    type: "constant",
    id: constant.id,
    snapshot: constant as unknown as Record<string, unknown>,
    proposedChanges: patchOps,
    bypass: approvalRequired && canBypass,
    title,
    revertedFrom: targetRevision.id,
  });

  try {
    await adapter.applyChanges(
      req.context,
      constant as unknown as Record<string, unknown>,
      fieldsToUpdate,
      { isRevert: true },
    );
  } catch (e) {
    try {
      await req.context.models.revisions.deleteById(merged.id);
    } catch {
      // ignore — surface the original applyChanges error
    }
    throw e;
  }

  await dispatchConstantRevisionEvent(req.context, merged, {
    type: "reverted",
  });

  return { revision: await toApiConstantRevision(merged, req.context) };
});
