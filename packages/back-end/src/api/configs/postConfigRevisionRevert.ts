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
import {
  assertConfigValueValid,
  assertConfigValueValidForPublish,
} from "back-end/src/services/configValidation";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
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
    if (isEqual(targetValue, liveValue)) continue;
    if (targetValue !== undefined) {
      fieldsToUpdate[field] = targetValue;
    } else if (field === "parent") {
      // Absent in the target but set live → clear the lineage on revert (an
      // empty string clears `parent`; see the merge path's clear handling).
      fieldsToUpdate[field] = "";
    } else if (field === "extends") {
      fieldsToUpdate[field] = [];
    }
    // Other optional fields absent in the target are left as-is: a revert never
    // needs to null them in practice, and clearing them generically risks
    // writing an invalid shape (e.g. an empty `schema`).
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new BadRequestError(
      `Revision #${req.params.version} matches the current config — nothing to revert.`,
    );
  }

  // Resolve the revert strategy up front so validation can match it: a publish
  // uses the bypassable publish-time check (block-vs-warn + ?ignoreWarnings),
  // while a draft uses the write-time check (a draft can be staged for later
  // review even if it won't pass publish).
  const revertsBypassApproval =
    !!req.organization.settings?.revertsBypassApproval;
  const strategy =
    req.body.strategy ?? (revertsBypassApproval ? "publish" : "draft");
  const isPublish = strategy === "publish";

  // A historical value may predate the current schema; ensure the post-revert
  // state still conforms (against current ancestors). Opt out with
  // ?skipSchemaValidation=true.
  const revertedValue =
    (fieldsToUpdate.value as string | undefined) ?? config.value;
  const revertedEnv =
    (fieldsToUpdate.environmentValues as Record<string, string> | undefined) ??
    config.environmentValues;
  const revertLeaf = {
    key: config.key,
    name: config.name,
    value: revertedValue,
    schema: (fieldsToUpdate.schema as typeof config.schema) ?? config.schema,
    parent: (fieldsToUpdate.parent as string | undefined) ?? config.parent,
    extends: (fieldsToUpdate.extends as string[] | undefined) ?? config.extends,
    extensible:
      (fieldsToUpdate.extensible as boolean | undefined) ?? config.extensible,
  };
  const revertValues = { value: revertedValue, environmentValues: revertedEnv };
  if (isPublish) {
    await assertConfigValueValidForPublish(
      req.context,
      revertLeaf,
      revertValues,
    );
  } else {
    await assertConfigValueValid(req.context, revertLeaf, revertValues);
  }

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
    await dispatchConfigRevisionEvent(req.context, draft, {
      type: "created",
    });
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

  await dispatchConfigRevisionEvent(req.context, merged, {
    type: "reverted",
  });

  return { revision: await toApiConfigRevision(merged, req.context) };
});
