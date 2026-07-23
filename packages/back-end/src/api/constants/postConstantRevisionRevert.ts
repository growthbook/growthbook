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
import { constantPublishEnvironments } from "back-end/src/revisions/revisionPublishEnvironments";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  applyPatchToSnapshot,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { assertConstantArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { assertConstantPublishGuards } from "back-end/src/services/publishGuards";
import { constantChangeAffectsServedValue } from "back-end/src/services/experimentGuard";
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
  if (
    !req.context.permissions.canRevisionAction(
      "constant",
      "revert",
      constant,
      constantPublishEnvironments(req.context),
    )
  ) {
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
    if (isEqual(targetValue, liveValue)) continue;
    if (targetValue !== undefined) {
      fieldsToUpdate[field] = targetValue;
    } else if (field === "environmentValues") {
      // Absent in target but set live → clear the per-env overrides.
      fieldsToUpdate[field] = {};
    }
    // Other optional fields absent in the target are left as-is.
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

  // Reverting to a historically-archived state re-archives the constant; enforce
  // the same soft referenced-constant warning as the archive endpoint (bypassable
  // by ignoreWarnings). Only the archive transition is guarded. Mirrors the config twin.
  if (isPublish && fieldsToUpdate.archived === true && !constant.archived) {
    await assertConstantArchiveDependentsGuard(
      req.context,
      { id: constant.id, key: constant.key, project: constant.project },
      { armed: false },
    );
  }

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
      canUseRestApiBypassSetting(req) ||
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

  // Guards (direct publish → armed:false): a revert-to-publish rewrites the
  // constant's live value like any other publish, so it must clear the guards
  // too. Other publish paths enforce them via assertPublishable, but this path
  // calls applyChanges directly (which doesn't), so enforce them here —
  // mirroring the config revert handler. Skipped for a metadata-only revert
  // (can't rewrite a served value).
  if (constantChangeAffectsServedValue(Object.keys(fieldsToUpdate))) {
    await assertConstantPublishGuards(
      req.context,
      constant,
      targetRevision,
      { armed: false },
      (fieldsToUpdate.value as string | undefined) ?? constant.value,
      "environmentValues" in fieldsToUpdate
        ? (fieldsToUpdate.environmentValues as Record<string, string>)
        : constant.environmentValues,
      // A revert that flips archived scrubs (or restores) refs — model the
      // transition so dependents' schema breaks are checked, like every other
      // publish path.
      "archived" in fieldsToUpdate ? !!fieldsToUpdate.archived : undefined,
    );
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
