import { isEqual } from "lodash";
import { JsonPatchOperation, Revision } from "shared/enterprise";
import { ConfigInterface } from "shared/types/config";
import {
  postConfigRevisionRevertValidator,
  configUpdatableFieldsSchema,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  applyPatchToSnapshot,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionRevert = createApiRequestHandler(
  postConfigRevisionRevertValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const adapter = getAdapter("config");
  if (!adapter.canUpdate(req.context, config as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  const targetRevision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  if (targetRevision.status !== "merged") {
    throw new BadRequestError(
      "Can only revert to a published (merged) revision. " +
        `Revision #${req.params.version} has status "${targetRevision.status}".`,
    );
  }

  // Reconstruct the config's state at the time of the historical revision (base
  // snapshot + its proposed changes = post-merge state).
  const targetState = applyPatchToSnapshot(
    targetRevision.target.snapshot as ConfigInterface,
    targetRevision.target.proposedChanges,
  ) as ConfigInterface;

  // Diff vs the current live config; omit fields equal to live.
  const fieldsToUpdate: Record<string, unknown> = {};
  for (const field of Object.keys(configUpdatableFieldsSchema.shape)) {
    const targetValue = (targetState as Record<string, unknown>)[field];
    const liveValue = (config as unknown as Record<string, unknown>)[field];
    if (targetValue !== undefined && !isEqual(targetValue, liveValue)) {
      fieldsToUpdate[field] = targetValue;
    }
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new BadRequestError(
      `Revision #${req.params.version} matches the current config — nothing to revert.`,
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

  let approvalRequired = false;
  let canBypass = false;
  if (isPublish) {
    approvalRequired = revertsBypassApproval
      ? false
      : adapter.isApprovalRequiredForRevision
        ? adapter.isApprovalRequiredForRevision(req.context, {
            target: { snapshot: config, proposedChanges: patchOps },
          } as unknown as Revision)
        : adapter.isApprovalRequired(req.context);
    canBypass =
      !!req.organization.settings?.restApiBypassesReviews ||
      adapter.canBypassApproval(req.context, config as Record<string, unknown>);
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
    "config",
    config as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  const title = req.body.title ?? `Revert to v${req.params.version}`;

  if (!isPublish) {
    const draft = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      patchOps,
      { forceCreate: true, title, revertedFrom: targetRevision.id },
    );
    return { revision: await toApiConfigRevision(draft, req.context) };
  }

  // Record the already-merged revert revision FIRST, then apply it. If the apply
  // fails, delete the just-created revision so we never leave a "reverted"
  // record with no corresponding live change.
  const merged = await req.context.models.revisions.createMerged({
    type: "config",
    id: config.id,
    snapshot: config as unknown as Record<string, unknown>,
    proposedChanges: patchOps,
    bypass: approvalRequired && canBypass,
    title,
    revertedFrom: targetRevision.id,
  });

  try {
    // applyChanges re-runs "base wins" normalization + cascades the reconcile.
    await adapter.applyChanges(
      req.context,
      config as unknown as Record<string, unknown>,
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

  return { revision: await toApiConfigRevision(merged, req.context) };
});
