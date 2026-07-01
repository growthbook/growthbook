import type { Response } from "express";
import { isEqual } from "lodash";
import { z } from "zod";
import {
  postConfigBodyValidator,
  putConfigBodyValidator,
  validateResolvableValue,
  getConstantReferenceKeys,
  getReferencingConstantKeys,
} from "shared/validators";
import { ConfigInterface, ConfigWithoutValue } from "shared/types/config";
import {
  Revision,
  normalizeProposedChanges,
  getConstantRevisionChange,
} from "shared/enterprise";
import {
  constantRequiresReview,
  parsePlainJSONObject,
  resolveConfigChain,
  linearizeConfigDag,
  getConfigSpineRootKey,
  getConfigParentKey,
  getConfigSpineSubtree,
  configIsExtensible,
  findIncompatibleConfigValueKeys,
  stripConfigExtends,
} from "shared/util";
import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  createOrUpdateRevision,
  buildPatchOps,
  applyPatchToSnapshot,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { getAdapter } from "back-end/src/revisions";
import {
  ConstantReferences,
  ConfigFamilyFeatureRef,
  loadConstantReferences,
  loadConfigFamilyFeatureReferences,
  assertConfigArchivable,
  assertConfigDeletable,
  assertKeyAvailable,
} from "back-end/src/services/constants";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import {
  reconcileConfigDescendants,
  assertConfigDescendantsReconcilable,
} from "back-end/src/services/configReconcile";
import {
  assertConfigValueValid,
  assertConfigValueValidForPublish,
} from "back-end/src/services/configValidation";
import {
  assertConfigNotLocked,
  resolveConfigLockTarget,
} from "back-end/src/services/configLock";
import { PlanDoesNotAllowError } from "back-end/src/util/errors";

type PostConfigBody = z.infer<typeof postConfigBodyValidator>;
type PutConfigBody = z.infer<typeof putConfigBodyValidator>;

// Loosely-typed shape the revision helpers expect for the live entity.
type RevisionEntityArg = Record<string, unknown> & {
  id: string;
  owner?: string;
  dateCreated?: Date;
};

export const getConfigs = async (
  req: AuthRequest,
  res: Response<{ status: 200; configs: ConfigWithoutValue[] }>,
) => {
  const context = getContextFromReq(req);
  const configs = await context.models.configs.getAllWithoutValues();
  return res.status(200).json({ status: 200, configs });
};

export const getConfigDraftStates = async (
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const ids = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;
  const configs = await context.models.revisions.getActiveDraftStates(
    "config",
    ids,
  );
  return res.status(200).json({ status: 200, configs });
};

// Keys that would close a cycle if this config referenced them (both collections).
export const getConfigCyclicKeys = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; cyclicKeys: string[] }>,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.configs.getById(req.params.id);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }
  // Config cycles live entirely in the config namespace, so scope the graph to
  // configs and count only `@config:` references.
  const all = (await getResolvableValues(context)).filter(
    (c) => c.source === "config",
  );
  const referencesByKey = new Map(
    all.map((c) => [
      c.key,
      getConstantReferenceKeys(c.value, undefined, "config"),
    ]),
  );
  const cyclicKeys = [
    ...getReferencingConstantKeys(config.key, referencesByKey),
  ];
  return res.status(200).json({ status: 200, cyclicKeys });
};

export const getConfigReferences = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 } & ConstantReferences>,
) => {
  const context = getContextFromReq(req);
  const references = await loadConstantReferences(context, req.params.id);
  if (!references) {
    return context.throwNotFoundError("Config not found");
  }
  return res.status(200).json({ status: 200, ...references });
};

// Features referencing any config in this config's lineage family — for the
// detail-page "Features" sidebar tab.
export const getConfigFamilyReferences = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    familyKeys: string[];
    features: ConfigFamilyFeatureRef[];
  }>,
) => {
  const context = getContextFromReq(req);
  const result = await loadConfigFamilyFeatureReferences(
    context,
    req.params.id,
  );
  if (!result) {
    return context.throwNotFoundError("Config not found");
  }
  return res.status(200).json({ status: 200, ...result });
};

// Number of fields a config defines in its own value (excluding `$extends`).
function configOwnFieldCount(value: string | undefined): number {
  const obj = parsePlainJSONObject(value ?? "");
  if (!obj) return 0;
  return Object.keys(obj).filter((k) => k !== CONSTANT_EXTENDS_KEY).length;
}

// The config plus its effective schema, resolved per-field values, and lineage.
export const getConfigResolved = async (
  req: AuthRequest<null, { key: string }, { v?: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.configs.getByKey(req.params.key);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }

  // When a draft revision is in view (`?v=<version>`), resolve against its
  // proposed state so the chain, effective schema, and lineage reflect
  // unpublished `parent`/`extends`/value/schema edits (composition is otherwise
  // invisible until publish).
  let leaf: ConfigInterface = config;
  const versionRaw = req.query.v;
  const version =
    typeof versionRaw === "string" && /^\d+$/.test(versionRaw)
      ? Number(versionRaw)
      : null;
  if (version !== null) {
    const rev = await context.models.revisions.getByTargetAndVersion(
      "config",
      config.id,
      version,
    );
    // Only an open draft alters resolution; merged/discarded resolve as live.
    if (rev && rev.status !== "merged" && rev.status !== "discarded") {
      leaf = {
        ...config,
        ...applyPatchToSnapshot(
          rev.target.snapshot as ConfigInterface,
          normalizeProposedChanges(rev.target.proposedChanges),
        ),
      };
    }
  }

  // Build the lineage map once and linearize the full base DAG (parent + every
  // `extends` mixin) base → leaf for resolution. The draft leaf is substituted
  // so its proposed bases drive the walk. Lineage can span projects the caller
  // can't read, so use the unfiltered set (read access to the target itself was
  // gated above) — matching the REST lineage/schema endpoints — so resolution
  // isn't silently truncated when an ancestor/mixin lives elsewhere.
  const allConfigs = (await context.models.configs.getAllForReconcile()).map(
    (c) => (c.key === config.key ? leaf : c),
  );
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  byKey.set(config.key, leaf);

  const chain = linearizeConfigDag(config.key, byKey);
  const { effectiveSchema, fields } = resolveConfigChain(chain);

  // Whether the family allows extra keys — governed by the `parent`-spine root's
  // checkbox (mixin bases' extensibility is ignored) / org default.
  const spineRoot = byKey.get(getConfigSpineRootKey(config.key, byKey));
  const extensible = configIsExtensible(
    spineRoot,
    context.org.settings?.configsExtensibleByDefault,
  );

  // Scoped to this config's project + globals so cross-project values never leak.
  const configProject = config.project || "";
  const constants = (await getResolvableValues(context))
    .filter((c) => !c.project || c.project === configProject)
    .map((c) => ({
      key: c.key,
      type: c.type,
      source: c.source,
      value: c.value,
      project: c.project,
      archived: c.archived,
    }));

  // Own value keys that no longer conform to a node's effective schema (the
  // "incompatible, must fix" state). Reuses `byKey` so it's a pure in-memory walk.
  const incompatibleFieldsFor = (nodeKey: string): string[] => {
    const node = byKey.get(nodeKey);
    if (!node) return [];
    const nodeFields = resolveConfigChain(
      linearizeConfigDag(nodeKey, byKey),
    ).effectiveSchema;
    const incompatible = new Set<string>();
    for (const raw of [node.value]) {
      const obj = parsePlainJSONObject(raw ?? "");
      if (!obj) continue;
      for (const k of findIncompatibleConfigValueKeys({
        value: obj,
        fields: nodeFields,
      })) {
        incompatible.add(k);
      }
    }
    return [...incompatible];
  };

  // The sidebar tree keeps the `parent` spine shape, so root it at the spine
  // root (walk parent only); composition mixins surface as `extendsKeys` chips
  // on each node rather than as separate tree branches.
  const spineRootKey = getConfigSpineRootKey(config.key, byKey);

  const buildSpineLineage = (rootKey: string) =>
    getConfigSpineSubtree(rootKey, allConfigs).flatMap((key) => {
      const node = byKey.get(key);
      if (!node) return [];
      return [
        {
          key: node.key,
          name: node.name,
          parentKey: getConfigParentKey(node),
          // Composition mixins (the non-spine bases) for same-level chips.
          extendsKeys: node.extends ?? [],
          fieldCount: configOwnFieldCount(node.value),
          // Own schema field keys, so the editor can preview "base wins"
          // reconciliation (a descendant's field is stripped when an ancestor
          // declares the same key).
          fieldKeys: (node.schema?.fields ?? []).map((f) => f.key),
          incompatibleFields: incompatibleFieldsFor(node.key),
        },
      ];
    });

  const lineage = buildSpineLineage(spineRootKey);

  // Families that compose THIS config as a mixin (`extends`). A pure mixin has
  // no `parent`-spine descendants of its own, so without this its sidebar tree is
  // just a lone node — these surface "where am I used" as one tree per composing
  // family. Deduped by spine root so sibling composers in the same family render
  // a single tree, and the config's own family is excluded (it's already shown).
  const composerRootKeys = [
    ...new Set(
      allConfigs
        .filter(
          (c) => c.key !== config.key && (c.extends ?? []).includes(config.key),
        )
        .map((c) => getConfigSpineRootKey(c.key, byKey)),
    ),
  ].filter((rk) => rk !== spineRootKey);

  const composerFamilies = composerRootKeys.map((rootKey) => ({
    rootKey,
    lineage: buildSpineLineage(rootKey),
  }));

  // Own-value field count + display name for every config, keyed by config key,
  // so the lineage tree can label/count mixin rows (mixins usually live outside
  // this config's family, so they aren't present as lineage nodes).
  const fieldCounts: Record<string, number> = {};
  const configNames: Record<string, string> = {};
  const archivedByKey: Record<string, boolean> = {};
  for (const c of byKey.values()) {
    fieldCounts[c.key] = configOwnFieldCount(c.value);
    configNames[c.key] = c.name;
    if (c.archived) archivedByKey[c.key] = true;
  }

  return res.status(200).json({
    status: 200,
    config,
    chain,
    effectiveSchema,
    extensible,
    fields,
    lineage,
    composerFamilies,
    fieldCounts,
    configNames,
    archivedByKey,
    constants,
  });
};

export const postConfig = async (
  req: AuthRequest<PostConfigBody>,
  res: Response<{ status: 200; config: ConfigInterface }>,
) => {
  const context = getContextFromReq(req);
  const body = req.body;

  // Check create permission BEFORE probing project existence so the endpoint
  // can't be used as an existence oracle (the model's canCreate enforces it too).
  if (
    !context.permissions.canCreateConfig({ project: body.project || undefined })
  ) {
    context.permissions.throwPermissionError();
  }

  // Configs are a premium feature, gated on creation only — existing configs
  // stay editable/deletable after a license lapses (err permissive).
  if (!context.hasPremiumFeature("feature-configs")) {
    throw new PlanDoesNotAllowError(
      "Creating configs requires a plan that includes feature configs.",
    );
  }

  if (body.project) {
    await context.models.projects.ensureProjectsExist([body.project]);
  }

  // Config values are JSON objects (empty is allowed). Lineage is expressed via
  // `parent`/`extends`, so a `@config:` ref in the value is rejected.
  validateResolvableValue({
    type: "json",
    value: body.value ?? "",
    refSource: "config",
  });

  // Cycle rejection is enforced in ConfigModel (covers every write path).

  // Config keys are unique within the config namespace (a constant may share the
  // key — `@config:foo` and `@const:foo` are distinct).
  await assertKeyAvailable(context, body.key, "config");

  // Inheritance lives on `parent` (spine) + `extends` (mixins); never in value.
  const parent = body.parent || "";
  const extendsKeys = body.extends;

  // A child created under a base can't re-declare an inherited field ("base
  // wins"); strip any colliding keys from its appended schema up front.
  const normalizedSchema =
    await context.models.configs.normalizeSchemaAgainstAncestors(
      {
        key: body.key,
        parent: parent || undefined,
        extends: extendsKeys,
        value: body.value,
      },
      body.schema,
    );

  // Permission is enforced by the model's canCreate.
  const config = await context.models.configs.create({
    key: body.key,
    name: body.name,
    owner: body.owner || context.userId,
    parent: parent || undefined,
    extends: extendsKeys,
    value: stripConfigExtends(body.value),
    description: body.description,
    project: body.project,
    schema: normalizedSchema,
    extensible: body.extensible,
  });

  // Backfill an initial "live" revision so the history view has a baseline.
  await ensureLiveRevisionExists(
    context,
    "config",
    config as unknown as RevisionEntityArg,
  );

  return res.status(200).json({ status: 200, config });
};

type PutConfigRequest = AuthRequest<
  PutConfigBody,
  { id: string },
  {
    bypassApproval?: string;
    autoPublish?: string;
    revisionId?: string;
    forceCreateRevision?: string;
    title?: string;
    revertedFrom?: string;
  }
>;

type PutConfigResponse =
  | { status: 200; requiresApproval?: false; revision?: Revision }
  | { status: 202; requiresApproval: boolean; revision: Revision };

// All edits flow through the revision system (same approval model as constants):
// merged immediately when approval isn't required, else stored as a draft.
export const putConfig = async (
  req: PutConfigRequest,
  res: Response<PutConfigResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const {
    name,
    owner,
    parent,
    value,
    description,
    project,
    archived,
    schema,
    extensible,
    renderProjections,
  } = req.body;
  const extendsKeys = req.body.extends;
  const { id } = req.params;

  // Inheritance lives on `parent` (spine) + `extends` (mixins); strip any stray
  // `$extends` from the value (a `@config:` there is rejected upstream).
  const normalizedValue =
    typeof value !== "undefined" ? stripConfigExtends(value) : undefined;
  const incomingParent = parent;

  const existing = await context.models.configs.getById(id);
  if (!existing) {
    return context.throwNotFoundError("Config not found");
  }

  if (
    !context.permissions.canUpdateConfig(existing, {
      project: project ?? existing.project,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  // Config values are JSON objects (empty is allowed). Lineage is set via
  // `parent`/`extends`, so a `@config:` ref in the value is rejected.
  if (typeof value !== "undefined") {
    validateResolvableValue({ type: "json", value, refSource: "config" });
  }

  // Cycle rejection is enforced in ConfigModel (covers every write path).

  // If updating a specific revision, compare against its current (patched) state
  // rather than the live entity so we don't re-propose unchanged fields.
  const revisionId = req.query.revisionId;
  let comparisonBase: ConfigInterface = existing;
  if (revisionId) {
    const targetRevision = await context.models.revisions.getById(revisionId);
    if (targetRevision && targetRevision.target.type === "config") {
      const patchedSnapshot = applyPatchToSnapshot(
        targetRevision.target.snapshot as ConfigInterface,
        normalizeProposedChanges(targetRevision.target.proposedChanges),
      );
      comparisonBase = { ...existing, ...patchedSnapshot };
    }
  }

  // null/undefined means "field wasn't intentionally changed".
  const hasChanged = (newVal: unknown, oldVal: unknown): boolean => {
    if ((newVal ?? null) === null) return false;
    if ((oldVal ?? null) === null) return true;
    return !isEqual(newVal, oldVal);
  };

  const fieldsToUpdate: Partial<ConfigInterface> = {};
  if (typeof name !== "undefined" && hasChanged(name, comparisonBase.name)) {
    fieldsToUpdate.name = name;
  }
  if (typeof owner !== "undefined" && hasChanged(owner, comparisonBase.owner)) {
    fieldsToUpdate.owner = owner;
  }
  if (
    incomingParent !== undefined &&
    (incomingParent || "") !== (comparisonBase.parent || "")
  ) {
    // Persist a clear as "" (not null/undefined): buildPatchOps drops null/
    // undefined, which would silently no-op the clear and skip the schema
    // re-normalization that a lineage change requires.
    fieldsToUpdate.parent = incomingParent || "";
  }
  if (
    extendsKeys !== undefined &&
    !isEqual(extendsKeys, comparisonBase.extends ?? [])
  ) {
    // Store the array as-is (including `[]` to clear all mixins). An empty
    // array — not `undefined` — is the canonical "no mixins" value: `undefined`
    // is dropped by buildPatchOps/the update layer, so it would silently no-op
    // the clear.
    fieldsToUpdate.extends = extendsKeys;
  }
  if (hasChanged(normalizedValue, comparisonBase.value)) {
    fieldsToUpdate.value = normalizedValue;
  }
  if (hasChanged(description, comparisonBase.description)) {
    fieldsToUpdate.description = description;
  }
  if (hasChanged(project, comparisonBase.project)) {
    if (project) {
      await context.models.projects.ensureProjectsExist([project]);
    }
    fieldsToUpdate.project = project;
  }
  if (hasChanged(archived, comparisonBase.archived)) {
    fieldsToUpdate.archived = archived;
  }
  // `schema` (config field definitions) is a content change like `value`.
  if (hasChanged(schema, comparisonBase.schema)) {
    fieldsToUpdate.schema = schema;
  }
  if (extensible !== undefined && extensible !== comparisonBase.extensible) {
    fieldsToUpdate.extensible = extensible;
  }
  // Per-source render projections. `{}` is a meaningful value (clears the last
  // projection), so compare with isEqual rather than the null-coalescing helper.
  if (
    renderProjections !== undefined &&
    !isEqual(renderProjections, comparisonBase.renderProjections ?? {})
  ) {
    fieldsToUpdate.renderProjections = renderProjections;
  }

  // Enforce "base wins": never let a child config persist a schema field whose
  // key a published ancestor already owns. A lineage change (parent/extends)
  // shifts which keys the bases own, so re-normalize the config's own schema even
  // when the caller didn't send one. The publish path (adapter) re-runs this
  // against ancestors-at-publish; doing it here keeps drafts honest too.
  const lineageChanged =
    fieldsToUpdate.parent !== undefined || "extends" in fieldsToUpdate;
  const schemaToNormalize = fieldsToUpdate.schema ?? existing.schema;
  if ((fieldsToUpdate.schema || lineageChanged) && schemaToNormalize) {
    const normalized =
      await context.models.configs.normalizeSchemaAgainstAncestors(
        {
          key: existing.key,
          parent: fieldsToUpdate.parent ?? existing.parent,
          extends: extendsKeys ?? existing.extends,
          value: fieldsToUpdate.value ?? existing.value,
        },
        schemaToNormalize,
      );
    // Stage a schema write if normalization changed the schema we were about to
    // persist (the sent schema or the existing one) — not vs. `existing.schema`,
    // which would skip persisting a normalized form of a freshly-sent schema.
    if (!isEqual(normalized, schemaToNormalize)) {
      fieldsToUpdate.schema = normalized;
    }
  }

  // Block the archive transition when the config is still referenced or has
  // live child configs inheriting from it.
  if (fieldsToUpdate.archived === true && !comparisonBase.archived) {
    await assertConfigArchivable(context, existing);
  }

  // The proposed (merged) config state, used to validate the staged value(s)
  // against the effective schema — same check the REST write path enforces, so
  // the UI can't save/publish a schema-violating value.
  const proposed = { ...existing, ...fieldsToUpdate } as ConfigInterface;
  const proposedLeaf = {
    key: proposed.key,
    name: proposed.name,
    value: proposed.value,
    schema: proposed.schema,
    parent: proposed.parent,
    extends: proposed.extends,
    extensible: proposed.extensible,
  };
  const proposedValues = {
    value: proposed.value,
  };
  const valueAffectingChange =
    fieldsToUpdate.value !== undefined ||
    fieldsToUpdate.schema !== undefined ||
    fieldsToUpdate.parent !== undefined ||
    "extends" in fieldsToUpdate;
  if (valueAffectingChange) {
    await assertConfigValueValid(context, proposedLeaf, proposedValues);
  }

  const forceCreateRevision = req.query.forceCreateRevision === "1";
  const bypassApproval = req.query.bypassApproval === "1";
  const autoPublish = req.query.autoPublish === "1";
  const title = req.query.title;
  const revertedFrom = req.query.revertedFrom;

  const wantsDraft = !!revisionId || forceCreateRevision;
  const wantsMerge = bypassApproval || autoPublish || !wantsDraft;

  if (
    Object.keys(fieldsToUpdate).length === 0 &&
    !forceCreateRevision &&
    !bypassApproval &&
    !autoPublish
  ) {
    return res.status(200).json({ status: 200 });
  }

  await ensureLiveRevisionExists(
    context,
    "config",
    existing as unknown as RevisionEntityArg,
  );

  const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);

  // Configs inherit the feature `requireReviews` settings (same as constants).
  const approvalRequired = constantRequiresReview(
    { project: existing.project },
    getConstantRevisionChange(existing, patchOps),
    org.settings,
  );

  // Block publishing past a locked config's pinned revision (creating/editing
  // drafts stays allowed). Guard before creating or claiming a merge so a blocked
  // publish leaves nothing behind. Unlock (bypassApprovalChecks) to publish.
  const willPublish =
    wantsMerge && (!approvalRequired || bypassApproval || autoPublish);
  if (willPublish) {
    assertConfigNotLocked(existing);
  }

  const forceCreate = wantsMerge || forceCreateRevision;

  let revision = await createOrUpdateRevision(
    context,
    "config",
    existing as unknown as Record<string, unknown> & { id: string },
    patchOps,
    {
      forceCreate,
      title,
      revertedFrom,
      revisionId:
        wantsDraft && !bypassApproval && !autoPublish ? revisionId : undefined,
    },
  );

  if (wantsMerge) {
    const canBypass = getAdapter("config").canBypassApproval(
      context,
      existing as unknown as Record<string, unknown>,
    );

    if (bypassApproval && approvalRequired && !canBypass) {
      context.permissions.throwPermissionError();
    }

    if (autoPublish && approvalRequired && !canBypass) {
      const isRevertBypass =
        !!revertedFrom && !!org.settings?.revertsBypassApproval;
      if (!isRevertBypass) {
        context.permissions.throwPermissionError();
      }
    }

    const canImmediatelyMerge =
      !approvalRequired || bypassApproval || autoPublish;

    if (canImmediatelyMerge) {
      const isBypass = approvalRequired && bypassApproval;

      // Dry run BEFORE claiming the merge / writing the root: reject a publish
      // that would create an unresolvable sibling conflict at a descendant, so
      // nothing is persisted (vs. committing the root and then throwing from the
      // post-write cascade). See assertConfigDescendantsReconcilable for the
      // accepted residual race.
      if (
        fieldsToUpdate.schema !== undefined ||
        fieldsToUpdate.parent !== undefined ||
        "extends" in fieldsToUpdate
      ) {
        await assertConfigDescendantsReconcilable(context, {
          ...existing,
          ...fieldsToUpdate,
        } as ConfigInterface);
      }

      // Publish-time safety net (adds required-field enforcement on top of the
      // per-write conformance check): block publishing a value that doesn't
      // match the effective schema. Runs before the merge claim so nothing is
      // persisted on failure.
      await assertConfigValueValidForPublish(
        context,
        proposedLeaf,
        proposedValues,
      );

      // Claim the merge first (CAS-guarded) so a concurrent discard can't orphan
      // a half-applied change; reopen if the live write then fails.
      revision = await context.models.revisions.merge(
        revision.id,
        context.userId,
        { bypass: isBypass },
      );

      try {
        await context.models.configs.update(
          existing,
          fieldsToUpdate as Parameters<typeof context.models.configs.update>[1],
        );
      } catch (e) {
        try {
          await context.models.revisions.reopen(revision.id, context.userId);
        } catch {
          // ignore — surface the original update error
        }
        throw e;
      }

      // A schema/lineage change can introduce a field a descendant already
      // declares; cascade "base wins" down the subtree (system-normalized live
      // writes).
      if (
        fieldsToUpdate.schema !== undefined ||
        fieldsToUpdate.parent !== undefined ||
        "extends" in fieldsToUpdate
      ) {
        await reconcileConfigDescendants(context, existing.key);
      }

      return res.status(200).json({ status: 200, revision });
    }
  }

  return res.status(202).json({
    status: 202,
    requiresApproval: approvalRequired,
    revision,
  });
};

export const deleteConfig = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const existing = await context.models.configs.getById(req.params.id);
  if (!existing) {
    return context.throwNotFoundError("Config not found");
  }
  // Check delete permission before the (DB-scanning) dependency assertion, so a
  // reader without manage access gets a clean 403 rather than a dependency error.
  if (!context.permissions.canDeleteConfig(existing)) {
    context.permissions.throwPermissionError();
  }
  // Require the config to be archived first (mirrors constants): archive is
  // reversible and flows through approvals; delete isn't.
  if (!existing.archived) {
    throw new Error("Config must be archived before it can be deleted");
  }
  // A config others inherit from can't be deleted — it would dangle their
  // parent pointer.
  await assertConfigDeletable(context, existing);
  await context.models.configs.delete(existing);
  return res.status(200).json({ status: 200 });
};

// Freeze the config at its current published revision. Locking needs only edit
// authority (the asymmetry: unlocking is gated). The lock lives outside the
// revision merge allowlist, so write it directly after the auth check.
export const lockConfig = async (
  req: AuthRequest<{ reason?: string }, { id: string }>,
  res: Response<{ status: 200; config: ConfigInterface }>,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.configs.getById(req.params.id);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }
  if (!context.permissions.canUpdateConfig(config, config)) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: keep the existing pin if already locked.
  let result = config;
  if (!config.lock) {
    const { revisionId, version } = await resolveConfigLockTarget(
      context,
      config,
    );
    result = await context.models.configs.dangerousUpdateBypassPermission(
      config,
      {
        lock: {
          revisionId,
          version,
          lockedBy: context.userId,
          dateLocked: new Date(),
          ...(req.body?.reason ? { reason: req.body.reason } : {}),
        },
      },
    );
  }
  return res.status(200).json({ status: 200, config: result });
};

// Clear the lock so changes can be published again. Requires the elevated
// bypassApprovalChecks permission — the same trust that skips the review queue.
export const unlockConfig = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; config: ConfigInterface }>,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.configs.getById(req.params.id);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }
  if (
    !context.permissions.canBypassApprovalChecks({
      project: config.project || "",
    })
  ) {
    context.permissions.throwPermissionError();
  }

  // `null` clears the lock (a `$set`, since updates can't `$unset`).
  let result = config;
  if (config.lock) {
    result = await context.models.configs.dangerousUpdateBypassPermission(
      config,
      { lock: null },
    );
  }
  return res.status(200).json({ status: 200, config: result });
};
