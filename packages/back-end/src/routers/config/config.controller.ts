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
  configRequiresReview,
  parsePlainJSONObject,
  resolveConfigChain,
  linearizeConfigDag,
  getConfigSpineRootKey,
  getConfigParentKey,
  getConfigSpineSubtree,
  configIsExtensible,
  findIncompatibleConfigValueKeys,
  findOrphanedConfigValueKeys,
  formatAncestorFieldConflictMessage,
  collectConfigInvariantViolations,
  stripConfigExtends,
  ScopedOverrideEntry,
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
  ConfigKeyImplementation,
  loadConstantReferences,
  loadConfigFamilyFeatureReferences,
  getConfigKeyImplementations,
  assertConfigArchivable,
  assertConfigDeletable,
  assertKeyAvailable,
  assertScopedOverridesValid,
  assertScopedOverridesChangeAllowed,
  syncScopedConfigMarkers,
} from "back-end/src/services/constants";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import {
  reconcileConfigDescendants,
  assertConfigDescendantsReconcilable,
  assertConfigSchemaChangeSafeForDescendants,
} from "back-end/src/services/configReconcile";
import {
  assertConfigValueValid,
  assertConfigValueValidForCreate,
  assertConfigValueValidForPublish,
} from "back-end/src/services/configValidation";
import { runValidateConfigHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import {
  isValidRevertBypass,
  revertRestoresTargetSnapshot,
} from "back-end/src/services/configRevertBypass";
import {
  assertScopedOverridesExperimentGuard,
  configChangeAffectsServedValue,
} from "back-end/src/services/experimentGuard";
import { assertConfigPublishGuards } from "back-end/src/services/publishGuards";
import {
  assertConfigNotLocked,
  resolveConfigLockTarget,
} from "back-end/src/services/configLock";
import {
  BadRequestError,
  PlanDoesNotAllowError,
} from "back-end/src/util/errors";

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
  // Read-permission gate: resolveConfigFamily reads the unfiltered reconcile set,
  // so gate on the entry config here (getById is canRead-scoped) — else usage in a
  // project the caller can't read is disclosed. Mirrors getConfigCyclicKeys.
  const config = await context.models.configs.getById(req.params.id);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }
  const result = await loadConfigFamilyFeatureReferences(
    context,
    req.params.id,
  );
  if (!result) {
    return context.throwNotFoundError("Config not found");
  }
  return res.status(200).json({ status: 200, ...result });
};

// Feature rules and default values that override each key across this config's
// lineage family — for the detail-page per-key usage counts and drill-down.
export const getConfigKeyUsage = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    familyKeys: string[];
    implementations: ConfigKeyImplementation[];
  }>,
) => {
  const context = getContextFromReq(req);
  // Read-permission gate before the unfiltered family scan (see
  // getConfigFamilyReferences).
  const config = await context.models.configs.getById(req.params.id);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }
  const result = await getConfigKeyImplementations(context, req.params.id);
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
        // scopedOverrides/scopedConfig write immediately, not through revisions —
        // keep the LIVE values so a draft's (possibly stale) snapshot copy can't
        // clobber them and hide the env tabs while a draft is open.
        scopedOverrides: config.scopedOverrides,
        scopedConfig: config.scopedConfig,
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
      // Carry a config's env/project flavor selection so the client can resolve
      // per-environment (swap in the matching flavor) without a second fetch —
      // the flavor configs themselves are already in this resolvable set.
      ...(c.scopedOverrides?.length
        ? { scopedOverrides: c.scopedOverrides }
        : {}),
    }));

  // Own value keys that no longer conform to a node's effective schema (the
  // "incompatible, must fix" state) or that it no longer declares at all
  // (`orphaned` — what an ancestor's field removal leaves behind). Draft-aware
  // via the substituted leaf; reuses `byKey` so it's a pure in-memory walk.
  const valueFlagsFor = (
    nodeKey: string,
  ): { incompatibleFields: string[]; orphanedFields: string[] } => {
    const node = byKey.get(nodeKey);
    if (!node) return { incompatibleFields: [], orphanedFields: [] };
    const nodeFields = resolveConfigChain(
      linearizeConfigDag(nodeKey, byKey),
    ).effectiveSchema;
    const incompatible = new Set<string>();
    const orphaned = new Set<string>();
    for (const raw of [node.value]) {
      const obj = parsePlainJSONObject(raw ?? "");
      if (!obj) continue;
      for (const k of findIncompatibleConfigValueKeys({
        value: obj,
        fields: nodeFields,
      })) {
        incompatible.add(k);
      }
      for (const k of findOrphanedConfigValueKeys({
        value: obj,
        fields: nodeFields,
      })) {
        orphaned.add(k);
      }
    }
    return {
      incompatibleFields: [...incompatible],
      orphanedFields: [...orphaned],
    };
  };

  // The sidebar tree keeps the `parent` spine shape, so root it at the spine
  // root (walk parent only); composition mixins surface as `extendsKeys` chips
  // on each node rather than as separate tree branches.
  const spineRootKey = getConfigSpineRootKey(config.key, byKey);

  const buildSpineLineage = (rootKey: string) =>
    getConfigSpineSubtree(rootKey, allConfigs).flatMap((key) => {
      const node = byKey.get(key);
      // A spine subtree rooted at a global/shared base spans projects; drop
      // nodes the caller can't read so their name/count/etc. never ship to a
      // project-scoped viewer. Filtering at the source covers every consumer
      // (the target's own lineage, composer families, and the derived maps).
      if (
        !node ||
        !context.permissions.canReadSingleProjectResource(node.project)
      )
        return [];
      const { incompatibleFields, orphanedFields } = valueFlagsFor(node.key);
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
          // Ordered env/project variant selection (only on a base config), so the
          // editor can render the env-selector tab group + locate each flavor.
          ...(node.scopedOverrides?.length
            ? { scopedOverrides: node.scopedOverrides }
            : {}),
          // Self-describing flavor marker (only on a flavor), so the tree can
          // group env overrides under an "Environments" label under their parent.
          ...(node.scopedConfig ? { scopedConfig: node.scopedConfig } : {}),
          incompatibleFields,
          orphanedFields,
          // Failing effective invariants per node (draft leaf substituted), so
          // the editor can flag descendants a draft would leave in violation.
          invariantViolations: collectConfigInvariantViolations(
            node.key,
            byKey,
          ),
        },
      ];
    });

  const lineage = buildSpineLineage(spineRootKey);

  // Families that compose THIS config as a mixin (`extends`). A pure mixin has
  // no `parent`-spine descendants of its own, so without this its sidebar tree is
  // just a lone node — these surface "where am I used" as one tree per composing
  // family. Deduped by spine root so sibling composers in the same family render
  // a single tree, and the config's own family is excluded (it's already shown).
  // Only composers the caller can read — a config in another project that
  // mixes this one in must not leak its key/name to a viewer scoped to just the
  // target's project (these keys flow into configNames/fieldCounts below).
  const composerRootKeys = [
    ...new Set(
      allConfigs
        .filter(
          (c) =>
            c.key !== config.key &&
            (c.extends ?? []).includes(config.key) &&
            context.permissions.canReadSingleProjectResource(c.project),
        )
        .map((c) => getConfigSpineRootKey(c.key, byKey)),
    ),
  ].filter((rk) => rk !== spineRootKey);

  // buildSpineLineage already drops nodes the caller can't read (a family's
  // spine subtree can span projects), so the expanded contents are safe.
  const composerFamilies = composerRootKeys.map((rootKey) => ({
    rootKey,
    lineage: buildSpineLineage(rootKey),
  }));

  // Own-value field count + display name, keyed by config key, so the lineage
  // tree can label/count mixin rows (mixins usually live outside this config's
  // family, so they aren't present as lineage nodes). Scoped to the keys the
  // returned trees actually reference (lineage/composer nodes + their mixins) —
  // NOT every config org-wide, which would leak names/keys across projects.
  const referencedKeys = new Set<string>([config.key]);
  for (const fam of [{ lineage }, ...composerFamilies]) {
    for (const node of fam.lineage) {
      referencedKeys.add(node.key);
      if (node.parentKey) referencedKeys.add(node.parentKey);
      (node.extendsKeys ?? []).forEach((k) => referencedKeys.add(k));
    }
  }
  const fieldCounts: Record<string, number> = {};
  const configNames: Record<string, string> = {};
  const archivedByKey: Record<string, boolean> = {};
  for (const key of referencedKeys) {
    const c = byKey.get(key);
    if (!c) continue;
    // A node's mixin keys (extendsKeys) aren't spine nodes, so buildSpineLineage
    // doesn't filter them — a readable node can reference a mixin in a project
    // the caller can't read. Gate the map so that mixin's name/count don't leak.
    if (!context.permissions.canReadSingleProjectResource(c.project)) continue;
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
  // wins"): identical re-declarations are stripped up front (the editor
  // pre-blocks and previews these client-side); differing ones are rejected —
  // a strip can't preserve their intent.
  const { schema: normalizedSchema, conflicting } =
    await context.models.configs.normalizeSchemaAgainstAncestors(
      {
        key: body.key,
        parent: parent || undefined,
        extends: extendsKeys,
        value: body.value,
      },
      body.schema,
    );
  if (conflicting.length) {
    throw new BadRequestError(formatAncestorFieldConflictMessage(conflicting));
  }

  // Validate the value against its schema (incl. cross-field invariants) and run
  // customer validateConfig hooks — same as the REST create path, so a config
  // saved from the UI can't persist a value that violates its own schema.
  const storedValue = stripConfigExtends(body.value);
  const createLeaf = {
    key: body.key,
    name: body.name,
    value: storedValue,
    schema: normalizedSchema,
    parent: parent || undefined,
    extends: extendsKeys,
    extensible: body.extensible,
  };
  await assertConfigValueValid(context, createLeaf, { value: storedValue });
  // Creation goes live immediately, so also enforce required fields +
  // cross-field invariants (the publish-time checks).
  await assertConfigValueValidForCreate(context, createLeaf, {
    value: storedValue,
  });
  await runValidateConfigHooks({
    context,
    config: {
      key: body.key,
      name: body.name,
      project: body.project || "",
      value: storedValue,
      schema: normalizedSchema,
      parent: parent || undefined,
      extends: extendsKeys,
      extensible: body.extensible,
    },
    original: null,
  });

  // Seed the per-config experiment guard from the org default (a concrete
  // per-config flag, so later changing the org default doesn't retroactively
  // affect existing configs). An explicit body value wins.
  const experimentGuard =
    body.experimentGuard ??
    context.org.settings?.configExperimentGuardDefault ??
    false;

  await assertScopedOverridesValid(context, {
    key: body.key,
    project: body.project || "",
    scopedOverrides: body.scopedOverrides,
  });

  // Permission is enforced by the model's canCreate.
  const config = await context.models.configs.create({
    key: body.key,
    name: body.name,
    owner: body.owner || context.userId,
    parent: parent || undefined,
    extends: extendsKeys,
    value: storedValue,
    scopedOverrides: body.scopedOverrides,
    description: body.description,
    project: body.project,
    schema: normalizedSchema,
    extensible: body.extensible,
    experimentGuard,
  });

  // Backfill an initial "live" revision so the history view has a baseline.
  await ensureLiveRevisionExists(
    context,
    "config",
    config as unknown as RevisionEntityArg,
  );

  // Stamp the scopedConfig marker on any flavors this base selects at creation.
  if (body.scopedOverrides?.length) {
    await syncScopedConfigMarkers(
      context,
      config.key,
      [],
      body.scopedOverrides,
    );
  }

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
  // `scopedOverrides` is NOT handled here — it writes immediately via
  // PUT /configs/:id/scoped-overrides (setConfigScopedOverrides), never through
  // this revision flow. Any value in the body is ignored.
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
  // key a published ancestor already owns — an identical re-declaration strips
  // silently (the editor pre-blocks these and previews the strip client-side);
  // a contract-DIFFERING one is rejected, since a strip can't preserve its
  // intent. A lineage change (parent/extends) shifts which keys the bases own,
  // so re-normalize the config's own schema even when the caller didn't send
  // one. The publish path (adapter) re-runs this against ancestors-at-publish;
  // doing it here keeps drafts honest too.
  const lineageChanged =
    fieldsToUpdate.parent !== undefined || "extends" in fieldsToUpdate;
  const schemaToNormalize = fieldsToUpdate.schema ?? existing.schema;
  if ((fieldsToUpdate.schema || lineageChanged) && schemaToNormalize) {
    const { schema: normalized, conflicting } =
      await context.models.configs.normalizeSchemaAgainstAncestors(
        {
          key: existing.key,
          parent: fieldsToUpdate.parent ?? existing.parent,
          extends: extendsKeys ?? existing.extends,
          value: fieldsToUpdate.value ?? existing.value,
        },
        schemaToNormalize,
      );
    if (conflicting.length) {
      throw new BadRequestError(
        formatAncestorFieldConflictMessage(conflicting),
      );
    }
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

  // Customer validateConfig hooks gate updates too (matching the feature
  // analog and the create path); `original` carries the stored state so
  // incremental hooks can diff.
  await runValidateConfigHooks({
    context,
    config: {
      key: proposed.key,
      name: proposed.name,
      project: proposed.project || "",
      value: proposed.value,
      schema: proposed.schema,
      parent: proposed.parent || undefined,
      extends: proposed.extends,
      extensible: proposed.extensible,
    },
    original: {
      key: existing.key,
      name: existing.name,
      project: existing.project || "",
      value: existing.value,
      schema: existing.schema,
      parent: existing.parent || undefined,
      extends: existing.extends,
      extensible: existing.extensible,
    },
  });

  await ensureLiveRevisionExists(
    context,
    "config",
    existing as unknown as RevisionEntityArg,
  );

  const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);

  // Configs inherit the feature `requireReviews` settings (same as constants).
  // An env-scoped flavor's value change only needs review when its environments
  // fall in a review rule's scope — same logic as the revision adapter.
  const approvalRequired = configRequiresReview(
    { project: existing.project },
    getConstantRevisionChange(existing, patchOps),
    existing.scopedConfig ? (existing.scopedConfig.environments ?? []) : null,
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
      // A revert may auto-publish past review only when `revertedFrom` names a
      // genuine merged revision of THIS config AND the proposed changes actually
      // restore that revision's state. Validating the id alone isn't enough — the
      // change set comes from the caller's body, so a valid id could otherwise
      // front arbitrary values past review. Check per changed field (so a partial
      // revert still works), normalizing both sides via the adapter snapshot.
      const revertSource = revertedFrom
        ? await context.models.revisions.getById(revertedFrom)
        : null;
      let genuineRevert = false;
      if (
        isValidRevertBypass({
          revision: revertSource,
          entityType: "config",
          entityId: existing.id,
          revertsBypassApproval: !!org.settings?.revertsBypassApproval,
        }) &&
        revertSource
      ) {
        const revertAdapter = getAdapter("config");
        const targetSnap = revertAdapter.buildSnapshot(
          applyPatchToSnapshot(
            revertSource.target.snapshot as Record<string, unknown>,
            revertSource.target.proposedChanges,
          ),
        ) as Record<string, unknown>;
        const proposedSnap = revertAdapter.buildSnapshot(
          applyPatchToSnapshot(
            existing as unknown as Record<string, unknown>,
            patchOps,
          ),
        ) as Record<string, unknown>;
        genuineRevert = revertRestoresTargetSnapshot({
          changedFields: Object.keys(fieldsToUpdate),
          proposedSnapshot: proposedSnap,
          targetSnapshot: targetSnap,
        });
      }
      if (!genuineRevert) {
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
      // post-write cascade — see assertConfigDescendantsReconcilable for the
      // accepted residual race), then soft-warn when the change removes or
      // retypes fields descendants still use (?ignoreWarnings=true proceeds).
      if (
        fieldsToUpdate.schema !== undefined ||
        fieldsToUpdate.parent !== undefined ||
        "extends" in fieldsToUpdate
      ) {
        const proposedRoot = {
          ...existing,
          ...fieldsToUpdate,
        } as ConfigInterface;
        await assertConfigDescendantsReconcilable(context, proposedRoot);
        await assertConfigSchemaChangeSafeForDescendants(context, proposedRoot);
      }

      // Experiment guard (direct publish → armed:false). Skipped for a
      // metadata-only publish, which can't rewrite any served value.
      if (configChangeAffectsServedValue(Object.keys(fieldsToUpdate))) {
        await assertConfigPublishGuards(
          context,
          existing,
          revision,
          { armed: false },
          proposedLeaf,
        );
      }

      // Publish-time safety net (adds required-field enforcement on top of the
      // per-write conformance check): block publishing a value that doesn't
      // match the effective schema. Runs before the merge claim so nothing is
      // persisted on failure.
      await assertConfigValueValidForPublish(
        context,
        proposedLeaf,
        proposedValues,
        revision,
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
        // A schema/lineage change can introduce a field a descendant already
        // declares; cascade "base wins" down the subtree (system-normalized live
        // writes). Kept inside the try so a cascade failure reopens the revision
        // too — otherwise the revision stays "merged", the webhook never fires,
        // and the caller sees a 500 for a publish that half-happened.
        if (
          fieldsToUpdate.schema !== undefined ||
          fieldsToUpdate.parent !== undefined ||
          "extends" in fieldsToUpdate
        ) {
          await reconcileConfigDescendants(context, existing.key);
        }
      } catch (e) {
        try {
          await context.models.revisions.reopen(revision.id, context.userId);
        } catch {
          // ignore — surface the original update error
        }
        throw e;
      }

      await dispatchConfigRevisionEvent(context, revision, {
        type: revision.revertedFrom ? "reverted" : "published",
      });

      return res.status(200).json({ status: 200, revision });
    }
  }

  // Draft path (approval required, no immediate merge). Fire created/updated so
  // the draft lifecycle is observable via webhooks even from the internal UI.
  const updatedExisting =
    wantsDraft && !bypassApproval && !autoPublish && !!revisionId;
  await dispatchConfigRevisionEvent(
    context,
    revision,
    updatedExisting ? { type: "updated" } : { type: "created" },
  );

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
  // A locked config is frozen at its published revision; deleting it would
  // destroy that pinned revision. Refuse, matching the REST delete endpoint
  // (lock removal is separately gated behind bypassApprovalChecks).
  assertConfigNotLocked(existing);
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

// Toggle the per-config experiment guard. Asymmetric like lock/unlock: turning it
// ON needs only edit authority, turning it OFF (removing a protection) needs the
// elevated bypassApprovalChecks. The flag lives outside the revision merge
// allowlist, so it's written directly after the auth check.
export const setConfigExperimentGuard = async (
  req: AuthRequest<{ enabled: boolean }, { id: string }>,
  res: Response<{ status: 200; config: ConfigInterface }>,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.configs.getById(req.params.id);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }
  const enabled = !!req.body?.enabled;

  if (enabled) {
    if (!context.permissions.canUpdateConfig(config, config)) {
      context.permissions.throwPermissionError();
    }
  } else if (
    !context.permissions.canBypassApprovalChecks({
      project: config.project || "",
    })
  ) {
    context.permissions.throwPermissionError();
  }

  // Idempotent; the BaseModel update emits the audit-log entry.
  let result = config;
  if (!!config.experimentGuard !== enabled) {
    result = await context.models.configs.dangerousUpdateBypassPermission(
      config,
      { experimentGuard: enabled },
    );
  }
  return res.status(200).json({ status: 200, config: result });
};

// The env/project variant selection writes IMMEDIATELY (like lock/
// experimentGuard), never through the revision flow — keeping it live is what
// lets the env-tab UI resolve the family from any view. Attaching an
// empty-patch flavor changes no served value; changes involving value-bearing
// flavors DO, so they're gated below (approval + experiment guard) on top of
// the structural validity checks. afterUpdate refreshes affected SDK payloads.
export const setConfigScopedOverrides = async (
  req: AuthRequest<{ scopedOverrides: ScopedOverrideEntry[] }, { id: string }>,
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
  // A locked config is frozen at its pinned revision; attaching/reordering a
  // flavor is value-affecting (it changes what resolves per env), so it must not
  // bypass the lock. Unlock first to change overrides.
  assertConfigNotLocked(config);
  const scopedOverrides = req.body?.scopedOverrides ?? [];
  await assertScopedOverridesValid(
    context,
    { key: config.key, project: config.project, scopedOverrides },
    config.scopedOverrides ?? [],
  );
  await assertScopedOverridesChangeAllowed(
    context,
    config,
    config.scopedOverrides ?? [],
    scopedOverrides,
  );
  await assertScopedOverridesExperimentGuard(
    context,
    config,
    config.scopedOverrides ?? [],
    scopedOverrides,
  );
  const result = await context.models.configs.dangerousUpdateBypassPermission(
    config,
    { scopedOverrides },
  );
  // Keep each flavor's self-describing `scopedConfig` marker in sync (immediate,
  // not revision-managed — same as the selection list itself).
  await syncScopedConfigMarkers(
    context,
    config.key,
    config.scopedOverrides ?? [],
    scopedOverrides,
  );
  return res.status(200).json({ status: 200, config: result });
};
