import type { Response } from "express";
import { isEqual } from "lodash";
import { z } from "zod";
import {
  postConfigBodyValidator,
  putConfigBodyValidator,
  validateConstantValue,
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
  loadConstantReferences,
  assertConstantArchivable,
  assertKeyAvailableAcrossNamespace,
} from "back-end/src/services/constants";
import { getResolvableConstants } from "back-end/src/services/resolvableConstants";

type PostConfigBody = z.infer<typeof postConfigBodyValidator>;
type PutConfigBody = z.infer<typeof putConfigBodyValidator>;

// Loosely-typed shape the revision helpers expect for the live entity.
type RevisionEntityArg = Record<string, unknown> & {
  id: string;
  owner?: string;
  dateCreated?: Date;
};

// GET /configs — value-omitted projection (values can be large; the full value
// is fetched per-config via GET /configs/:key/resolved).
export const getConfigs = async (
  req: AuthRequest,
  res: Response<{ status: 200; configs: ConfigWithoutValue[] }>,
) => {
  const context = getContextFromReq(req);
  const configs = await context.models.configs.getAllWithoutValues();
  return res.status(200).json({ status: 200, configs });
};

// GET /configs-draft-states — active draft status counts per config id.
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

// GET /configs/:id/cyclic-keys — keys that already (transitively) reference this
// config; referencing any of them would close a cycle. The graph spans both
// collections (a config can reference constants and vice versa).
export const getConfigCyclicKeys = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; cyclicKeys: string[] }>,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.configs.getById(req.params.id);
  if (!config) {
    return context.throwNotFoundError("Config not found");
  }
  const all = await getResolvableConstants(context);
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

// GET /configs/:id/references — features, constants, and configs that reference
// this config via `@const:key`.
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

// The single `@const:<key>` parent a config extends (its lineage parent), or
// null for a base config. Configs use exactly one `$extends` ref.
function configParentKey(value: string | undefined): string | null {
  const obj = parsePlainJSONObject(value ?? "");
  const list = obj?.[CONSTANT_EXTENDS_KEY];
  if (!Array.isArray(list)) return null;
  const first = list.find((r): r is string => typeof r === "string");
  const m = first?.match(/^@const:([a-z0-9][a-z0-9_-]*)$/);
  return m ? m[1] : null;
}

// GET /configs/:key/resolved — the Configuration editor view: the config, its
// effective schema and per-field resolved values (walking base→leaf lineage),
// and the full lineage tree it belongs to.
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
    const parentKey = configParentKey(cur.value);
    cur = parentKey ? await context.models.configs.getByKey(parentKey) : null;
  }

  const { effectiveSchema, fields } = resolveConfigChain(chain);

  // Value-map inputs for the client to squash `@const:` references in the field
  // table (default values; same scrubbing as payload generation). Spans both
  // collections and is scoped to this config's project + globals so cross-project
  // values are never sent to the client.
  const configProject = config.project || "";
  const constants = (await getResolvableConstants(context))
    .filter((c) => !c.project || c.project === configProject)
    .map((c) => ({
      key: c.key,
      type: c.type,
      value: c.value,
      project: c.project,
      archived: c.archived,
    }));

  // Lineage tree: every config descending from this chain's base, so the editor
  // sidebar can render the whole family and browse between them.
  const allConfigs = await context.models.configs.getAll();
  const rootKey = chain[0]?.key ?? config.key;
  const lineage: { key: string; name: string; parentKey: string | null }[] = [];
  const seen = new Set<string>();
  const queue = [rootKey];
  while (queue.length) {
    const k = queue.shift() as string;
    if (seen.has(k)) continue;
    seen.add(k);
    const node = allConfigs.find((c) => c.key === k);
    if (!node) continue;
    lineage.push({
      key: node.key,
      name: node.name,
      parentKey: configParentKey(node.value),
    });
    for (const child of allConfigs) {
      if (configParentKey(child.value) === k) queue.push(child.key);
    }
  }

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
  validateConstantValue("json", body.value ?? "");
  for (const [envId, v] of Object.entries(body.environmentValues ?? {})) {
    validateConstantValue("json", v, envId);
  }

  // Cycle rejection is enforced in ConfigModel (covers every write path).

  // Keys must be unique across both constants and configs (shared `@const:`
  // namespace); pre-check for a friendly error.
  await assertKeyAvailableAcrossNamespace(context, body.key);

  // Permission is enforced by the model's canCreate.
  const config = await context.models.configs.create({
    key: body.key,
    name: body.name,
    owner: body.owner || context.userId,
    value: body.value,
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

// PUT /configs/:id — all edits flow through the revision system (same approval
// model as constants). When approval isn't required the change is merged
// immediately; otherwise it's stored as a draft for review.
export const putConfig = async (
  req: PutConfigRequest,
  res: Response<PutConfigResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const {
    name,
    owner,
    value,
    environmentValues,
    description,
    project,
    archived,
    schema,
  } = req.body;
  const { id } = req.params;

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
    validateConstantValue("json", value);
  }
  for (const [envId, v] of Object.entries(environmentValues ?? {})) {
    validateConstantValue("json", v, envId);
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
  if (hasChanged(value, comparisonBase.value)) {
    fieldsToUpdate.value = value;
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
