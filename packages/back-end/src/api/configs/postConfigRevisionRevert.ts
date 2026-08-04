import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { isEqual } from "lodash";
import { JsonPatchOperation, Revision } from "shared/enterprise";
import { ConfigInterface } from "shared/types/config";
import {
  postConfigRevisionRevertValidator,
  configUpdatableFieldsSchema,
} from "shared/validators";
import {
  applyRevertDirectly,
  assertCanRevertRevision,
  resolveRevertStrategy,
} from "back-end/src/revisions/revertActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { configPublishEnvironments } from "back-end/src/revisions/revisionPublishEnvironments";
import { configChangeAffectsServedValue } from "back-end/src/services/experimentGuard";
import { assertConfigPublishGuards } from "back-end/src/services/publishGuards";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  applyPatchToSnapshot,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import {
  assertConfigValueValid,
  assertConfigValueValidForPublish,
} from "back-end/src/services/configValidation";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionRevert = createApiRequestHandler(
  postConfigRevisionRevertValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  const adapter = getAdapter("config");
  const revertsBypassApproval =
    !!req.organization.settings?.revertsBypassApproval;
  const strategy = resolveRevertStrategy(
    req.body.strategy,
    revertsBypassApproval,
  );
  const isPublish = strategy === "publish";

  // Coarse standing, before the reconstruction below. The authoritative check is
  // assertCanRevertRevision once the change set is known — it needs the fields to
  // judge the footprint, the destination and whether an archive is being
  // restored. Subset-refusing: no footprint or purity path rescues a caller who
  // holds none of these in this project.
  if (
    (["revert", "publish", "draft"] as const).every(
      (action) =>
        !req.context.permissions.canRevisionAction(
          "config",
          action,
          config,
          NO_ENVIRONMENT_BINDING,
        ),
    )
  ) {
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

  // Reconstruct the historical revision's post-merge state (snapshot + changes).
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
    // A schema is absent (undefined) OR cleared (null) — both mean "no schema".
    // isEqual treats those as different, so normalize before deciding it changed;
    // otherwise reverting an already-cleared config to a pre-schema revision would
    // record a no-op "revert".
    if (
      field === "schema" &&
      (targetValue ?? null) === null &&
      (liveValue ?? null) === null
    ) {
      continue;
    }
    if (targetValue !== undefined) {
      fieldsToUpdate[field] = targetValue;
    } else if (field === "parent") {
      // Absent in target but set live → clear it; "" clears `parent`.
      fieldsToUpdate[field] = "";
    } else if (field === "extends") {
      fieldsToUpdate[field] = [];
    } else if (field === "description") {
      // Restore "no description": "" is a valid empty value that round-trips as
      // a normal replace op (no unset needed).
      fieldsToUpdate[field] = "";
    } else if (field === "schema") {
      // Restore "no schema" (free-form). `null` is the clear signal: it survives
      // the revision record's JSON round-trip (unlike a dropped `undefined`) and
      // reads as "no schema" everywhere (every reader uses `?.`/truthiness), and
      // it fires the descendant reconcile (the trigger tests `!== undefined`) so
      // descendants shed the removed schema's derived state.
      fieldsToUpdate[field] = null;
    }
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new BadRequestError(
      `Revision #${req.params.version} matches the current Config — nothing to revert.`,
    );
  }

  // Resolve the strategy up front so validation matches: publish uses the
  // bypassable publish-time check; a draft uses the write-time check (it can be
  // staged for later review even if it won't pass publish).

  // A publish-strategy revert advances live state, so block it while locked
  // (before any merge). A draft-strategy revert only stages a draft, so it's fine.
  if (isPublish) {
    assertConfigNotLocked(config);
  }
  // The archive-dependents guard for a re-archiving revert runs below via the
  // authoritative assertConfigPublishGuards call, which fingerprints the reverted
  // (proposed) value/lineage — a duplicate check here against the current live
  // state would only over-block a combined archive+reparent revert.

  // A historical value may predate the current schema; ensure the post-revert
  // state still conforms (against current ancestors).
  const revertedValue =
    (fieldsToUpdate.value as string | undefined) ?? config.value;
  const revertLeaf = {
    key: config.key,
    name: config.name,
    value: revertedValue,
    // A cleared schema (null) must reach the leaf as "no schema" — `?? config.schema`
    // would wrongly re-apply the live schema and validate the reverted value against it.
    schema:
      "schema" in fieldsToUpdate
        ? (fieldsToUpdate.schema as typeof config.schema)
        : config.schema,
    parent: (fieldsToUpdate.parent as string | undefined) ?? config.parent,
    extends: (fieldsToUpdate.extends as string[] | undefined) ?? config.extends,
    extensible:
      (fieldsToUpdate.extensible as boolean | undefined) ?? config.extensible,
  };
  const revertValues = { value: revertedValue };
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
      canUseRestApiBypassSetting(req) ||
      adapter.canBypassApproval(req.context, config as Record<string, unknown>);
    if (approvalRequired && !canBypass) {
      throw new BadRequestError(
        "This revert requires approval before changes can be published. " +
          'Use `strategy: "draft"` to create a draft for review, ' +
          "or use a role/token that grants FlagsBypassApprovals.",
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
    // Staging publishes nothing, so this answers for the project — but a restored
    // revision can still relocate the entity, which takes authoring rights in the
    // destination.
    assertCanRevertRevision({
      context: req.context,
      entityType: "config",
      entity: config as unknown as Record<string, unknown>,
      fields: fieldsToUpdate,
      landing: false,
      footprint: configPublishEnvironments(req.context, config),
    });
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

  // Authoritative: the revert atom over the right scope for this mode, plus the
  // classes a revert can span — a relocation's destination, and an archive
  // restore's delete atom. All of it in one place for every entity and surface.
  assertCanRevertRevision({
    context: req.context,
    entityType: "config",
    entity: config as unknown as Record<string, unknown>,
    fields: fieldsToUpdate,
    landing: true,
    footprint: configPublishEnvironments(req.context, config),
  });

  // Experiment guard (direct publish → armed:false): a revert-to-publish
  // rewrites the config's live value like any other publish, so it must clear
  // the guard too. Other publish paths enforce it via assertPublishable, but
  // this path calls applyChanges directly (which doesn't), so enforce it here.
  // Skipped for a metadata-only revert (can't rewrite a served value), matching
  // the other publish paths.
  if (configChangeAffectsServedValue(Object.keys(fieldsToUpdate))) {
    await assertConfigPublishGuards(
      req.context,
      config,
      targetRevision,
      { armed: false },
      {
        value: revertLeaf.value,
        schema: revertLeaf.schema,
        parent: revertLeaf.parent,
        extends: revertLeaf.extends,
        extensible: revertLeaf.extensible,
      },
      // A revert that flips archived scrubs (or restores) refs — model the
      // transition so dependents' schema breaks are checked, like every other
      // publish path.
      "archived" in fieldsToUpdate ? !!fieldsToUpdate.archived : undefined,
    );
  }

  // One implementation of record-then-apply-then-roll-back, which also reports a
  // failed rollback instead of swallowing it — a merged revision whose changes
  // never landed is phantom history.
  const merged = await applyRevertDirectly({
    context: req.context,
    entityType: "config",
    entity: config as unknown as Record<string, unknown> & { id: string },
    fields: fieldsToUpdate,
    patchOps,
    targetRevisionId: targetRevision.id,
    title,
    bypass: approvalRequired && canBypass,
  });

  await dispatchConfigRevisionEvent(req.context, merged, {
    type: "reverted",
  });

  return { revision: await toApiConfigRevision(merged, req.context) };
});
