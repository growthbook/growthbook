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
  ConfigChainNode,
  getConfigParentKey,
  getConfigSubtree,
  stripExtends,
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
  assertConstantArchivable,
  assertKeyAvailableAcrossNamespace,
} from "back-end/src/services/constants";
import { getResolvableValues } from "back-end/src/services/resolvableValues";

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
  const all = await getResolvableValues(context);
  const referencesByKey = new Map(
    all.map((c) => [
      c.key,
      getConstantReferenceKeys(c.value, c.environmentValues),
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
  req: AuthRequest<null, { key: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.configs.getByKey(req.params.key);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }

  // Walk ancestors (leaf → base), then reverse to base → leaf for resolution.
  const chain: ConfigChainNode[] = [];
  const visited = new Set<string>();
  let cur: typeof config | null = config;
  while (cur && !visited.has(cur.key)) {
    visited.add(cur.key);
    chain.unshift({
      key: cur.key,
      name: cur.name,
      value: cur.value,
      schema: cur.schema,
    });
    const parentKey = getConfigParentKey(cur);
    cur = parentKey ? await context.models.configs.getByKey(parentKey) : null;
  }

  const { effectiveSchema, fields } = resolveConfigChain(chain);

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

  // Every config descending from this chain's base, for the sidebar tree.
  const allConfigs = await context.models.configs.getAll();
  const rootKey = chain[0]?.key ?? config.key;
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  const lineage = getConfigSubtree(rootKey, allConfigs).flatMap((key) => {
    const node = byKey.get(key);
    if (!node) return [];
    return [
      {
        key: node.key,
        name: node.name,
        parentKey: getConfigParentKey(node),
        fieldCount: configOwnFieldCount(node.value),
      },
    ];
  });

  return res.status(200).json({
    status: 200,
    config,
    chain,
    effectiveSchema,
    fields,
    lineage,
    constants,
  });
};

export const postConfig = async (
  req: AuthRequest<PostConfigBody>,
  res: Response<{ status: 200; config: ConfigInterface }>,
) => {
  const context = getContextFromReq(req);
  const body = req.body;

  if (body.project) {
    await context.models.projects.ensureProjectsExist([body.project]);
  }

  // Config values are JSON objects (empty is allowed).
  validateResolvableValue({ type: "json", value: body.value ?? "" });
  for (const [envId, v] of Object.entries(body.environmentValues ?? {})) {
    validateResolvableValue({ type: "json", value: v, label: envId });
  }

  // Cycle rejection is enforced in ConfigModel (covers every write path).

  // Keys are unique across both constants and configs (shared `@const:` namespace).
  await assertKeyAvailableAcrossNamespace(context, body.key);

  // Inheritance lives on `parent`; never persist `$extends` in the value.
  const parent = body.parent || getConfigParentKey({ value: body.value }) || "";

  // Permission is enforced by the model's canCreate.
  const config = await context.models.configs.create({
    key: body.key,
    name: body.name,
    owner: body.owner || context.userId,
    parent: parent || undefined,
    value: stripExtends(body.value),
    environmentValues: body.environmentValues,
    description: body.description,
    project: body.project,
    schema: body.schema,
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
    environmentValues,
    description,
    project,
    archived,
    schema,
  } = req.body;
  const { id } = req.params;

  // Inheritance lives on `parent`; strip any `$extends` from the value and
  // migrate a legacy in-value ref into `parent` when the caller didn't set one.
  const normalizedValue =
    typeof value !== "undefined" ? stripExtends(value) : undefined;
  const incomingParent =
    parent !== undefined
      ? parent
      : typeof value !== "undefined"
        ? (getConfigParentKey({ value }) ?? undefined)
        : undefined;

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

  // Config values are JSON objects (empty is allowed).
  if (typeof value !== "undefined") {
    validateResolvableValue({ type: "json", value });
  }
  for (const [envId, v] of Object.entries(environmentValues ?? {})) {
    validateResolvableValue({ type: "json", value: v, label: envId });
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
    fieldsToUpdate.parent = incomingParent;
  }
  if (hasChanged(normalizedValue, comparisonBase.value)) {
    fieldsToUpdate.value = normalizedValue;
  }
  if (hasChanged(environmentValues, comparisonBase.environmentValues)) {
    fieldsToUpdate.environmentValues = environmentValues;
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

  // Block the archive transition when the config is still referenced.
  if (fieldsToUpdate.archived === true && !comparisonBase.archived) {
    await assertConstantArchivable(context, existing.id, "config");
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
  // Require the config to be archived first (mirrors constants): archive is
  // reversible and flows through approvals; delete isn't.
  if (!existing.archived) {
    throw new Error("Config must be archived before it can be deleted");
  }
  await context.models.configs.delete(existing);
  return res.status(200).json({ status: 200 });
};
