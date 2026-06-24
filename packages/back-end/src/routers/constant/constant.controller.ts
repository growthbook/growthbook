import type { Response } from "express";
import { isEqual } from "lodash";
import { z } from "zod";
import {
  postConstantBodyValidator,
  putConstantBodyValidator,
  validateConstantValue,
  getConstantReferenceKeys,
  getReferencingConstantKeys,
} from "shared/validators";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
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
} from "back-end/src/services/constants";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";

type PostConstantBody = z.infer<typeof postConstantBodyValidator>;
type PutConstantBody = z.infer<typeof putConstantBodyValidator>;

// Loosely-typed shape the revision helpers expect for the live entity.
type RevisionEntityArg = Record<string, unknown> & {
  id: string;
  owner?: string;
  dateCreated?: Date;
};

// GET /constants — value-omitted projection (values can be large; the full
// value is fetched per-constant via GET /constants/:id).
export const getConstants = async (
  req: AuthRequest,
  res: Response<{ status: 200; constants: ConstantWithoutValue[] }>,
) => {
  const context = getContextFromReq(req);
  const constants = await context.models.constants.getAllWithoutValues();
  return res.status(200).json({ status: 200, constants });
};

// GET /constants/draft-states — active draft status counts per constant id, for
// the "Draft Status" column on the list page (mirrors saved groups).
export const getConstantDraftStates = async (
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const ids = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;
  const constants = await context.models.revisions.getActiveDraftStates(
    "constant",
    ids,
  );
  return res.status(200).json({ status: 200, constants });
};

// GET /constants/:key — full constant (includes values), looked up by its
// human-readable `key` (the immutable, org-unique reference handle that powers
// the detail-page URL). Mutations and sub-resource endpoints below still take
// the internal `id` the client already holds after this fetch.
export const getConstantByKey = async (
  req: AuthRequest<null, { key: string }>,
  res: Response<{ status: 200; constant: ConstantInterface }>,
) => {
  const context = getContextFromReq(req);
  const constant = await context.models.constants.getByKey(req.params.key);
  if (!constant) {
    return context.throwNotFoundError("Constant not found");
  }
  return res.status(200).json({ status: 200, constant });
};

// GET /constants/:id/cyclic-keys — keys of constants that already (transitively)
// reference this one. Referencing any of them from this constant would close a
// cycle, so the editor scrubs them (plus this constant itself) from the picker.
// Conservative: the reference graph unions each constant's value + all env
// overrides across environments.
export const getConstantCyclicKeys = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; cyclicKeys: string[] }>,
) => {
  const context = getContextFromReq(req);
  const constant = await context.models.constants.getById(req.params.id);
  if (!constant) {
    return context.throwNotFoundError("Constant not found");
  }
  const all = await context.models.constants.getAll();
  const referencesByKey = new Map(
    all.map((c) => [
      c.key,
      getConstantReferenceKeys(c.value, c.environmentValues),
    ]),
  );
  const cyclicKeys = [
    ...getReferencingConstantKeys(constant.key, referencesByKey),
  ];
  return res.status(200).json({ status: 200, cyclicKeys });
};

// GET /constants/:id/references — features and other constants that reference
// this constant via `@const:key`.
export const getConstantReferences = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 } & ConstantReferences>,
) => {
  const context = getContextFromReq(req);
  const references = await loadConstantReferences(context, req.params.id);
  if (!references) {
    return context.throwNotFoundError("Constant not found");
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

// GET /constants/:key/resolved — the Configuration editor view for a `config`:
// the config itself, its effective schema and per-field resolved values (walking
// the base→leaf lineage), and the full lineage tree it belongs to.
export const getConstantConfigResolved = async (
  req: AuthRequest<null, { key: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const config = await context.models.constants.getByKey(req.params.key);
  if (!config || config.type !== "config") {
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
    cur = parentKey ? await context.models.constants.getByKey(parentKey) : null;
  }

  const { effectiveSchema, fields } = resolveConfigChain(chain);

  // Lineage tree: every config descending from this chain's base, so the editor
  // sidebar can render the whole family and let you browse between them.
  const allConfigs = (await context.models.constants.getAll()).filter(
    (c) => c.type === "config",
  );
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

  return res
    .status(200)
    .json({ status: 200, config, effectiveSchema, fields, lineage });
};

export const postConstant = async (
  req: AuthRequest<PostConstantBody>,
  res: Response<{ status: 200; constant: ConstantInterface }>,
) => {
  const context = getContextFromReq(req);
  const body = req.body;

  if (body.project) {
    await context.models.projects.ensureProjectsExist([body.project]);
  }

  // JSON constants must hold parseable JSON (empty is allowed).
  validateConstantValue(body.type, body.value ?? "");
  for (const [envId, v] of Object.entries(body.environmentValues ?? {})) {
    validateConstantValue(body.type, v, envId);
  }

  // Cycle rejection is enforced in ConstantModel (covers every write path).

  // Keys are unique per org; pre-check for a friendly error rather than a raw
  // duplicate-key failure from the unique index.
  if (await context.models.constants.getByKey(body.key)) {
    throw new Error(`A constant with key "${body.key}" already exists.`);
  }

  // Permission is enforced by the model's canCreate.
  const constant = await context.models.constants.create({
    key: body.key,
    name: body.name,
    // Owner is a userId; default to the creator when not explicitly provided.
    owner: body.owner || context.userId,
    type: body.type,
    value: body.value,
    environmentValues: body.environmentValues,
    description: body.description,
    project: body.project,
  });

  // Backfill an initial "live" revision so the history view has a baseline.
  await ensureLiveRevisionExists(
    context,
    "constant",
    constant as unknown as RevisionEntityArg,
  );

  return res.status(200).json({ status: 200, constant });
};

type PutConstantRequest = AuthRequest<
  PutConstantBody,
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

type PutConstantResponse =
  | { status: 200; requiresApproval?: false; revision?: Revision }
  | { status: 202; requiresApproval: boolean; revision: Revision };

// PUT /constants/:id
// All edits flow through the revision system. When approval isn't required the
// change is tracked as a revision and merged immediately; when it is required
// (and the caller can't bypass) the change is stored as a draft for review.
export const putConstant = async (
  req: PutConstantRequest,
  res: Response<PutConstantResponse | ApiErrorResponse>,
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
  } = req.body;
  const { id } = req.params;

  const existing = await context.models.constants.getById(id);
  if (!existing) {
    return context.throwNotFoundError("Constant not found");
  }

  // Permission check always runs regardless of approval flow status.
  if (
    !context.permissions.canUpdateConstant(existing, {
      project: project ?? existing.project,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  // JSON constants must hold parseable JSON (empty is allowed). Type is
  // immutable, so validate incoming values against the existing type.
  if (typeof value !== "undefined") {
    validateConstantValue(existing.type, value);
  }
  for (const [envId, v] of Object.entries(environmentValues ?? {})) {
    validateConstantValue(existing.type, v, envId);
  }

  // Cycle rejection is enforced in ConstantModel (covers every write path,
  // including the publish/applyChanges merge).

  // If updating a specific revision, compare against its current (patched) state
  // rather than the live entity so we don't re-propose unchanged fields.
  const revisionId = req.query.revisionId;
  let comparisonBase: ConstantInterface = existing;
  if (revisionId) {
    const targetRevision = await context.models.revisions.getById(revisionId);
    if (targetRevision && targetRevision.target.type === "constant") {
      const patchedSnapshot = applyPatchToSnapshot(
        targetRevision.target.snapshot as ConstantInterface,
        normalizeProposedChanges(targetRevision.target.proposedChanges),
      );
      comparisonBase = { ...existing, ...patchedSnapshot };
    }
  }

  // null/undefined means "field wasn't intentionally changed" (the form sends
  // null for untouched fields).
  const hasChanged = (newVal: unknown, oldVal: unknown): boolean => {
    if ((newVal ?? null) === null) return false;
    if ((oldVal ?? null) === null) return true;
    return !isEqual(newVal, oldVal);
  };

  const fieldsToUpdate: Partial<ConstantInterface> = {};
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

  // Block the archive transition when the constant is still referenced (same
  // gate as the REST archive endpoints and the front-end ConstantArchiveModal).
  // Mirrors saved groups; only archiving is blocked, never unarchiving.
  if (fieldsToUpdate.archived === true && !comparisonBase.archived) {
    await assertConstantArchivable(context, existing.id);
  }

  const forceCreateRevision = req.query.forceCreateRevision === "1";
  const bypassApproval = req.query.bypassApproval === "1";
  const autoPublish = req.query.autoPublish === "1";
  const title = req.query.title;
  const revertedFrom = req.query.revertedFrom;

  // If no draft-intent flag was provided we treat the request as an implicit
  // auto-publish so the change is still tracked as a revision and merged
  // immediately when approval isn't required.
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
    "constant",
    existing as unknown as RevisionEntityArg,
  );

  const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);

  // Constants inherit the feature `requireReviews` settings: a value change
  // requires review (all environments), a per-env override only when its
  // environment is in scope, metadata per the rule's metadata-review toggle.
  // Computed against the live entity + this change, matching the merge endpoint.
  const approvalRequired = constantRequiresReview(
    { project: existing.project },
    getConstantRevisionChange(existing, patchOps),
    org.settings,
  );

  const forceCreate = wantsMerge || forceCreateRevision;

  let revision = await createOrUpdateRevision(
    context,
    "constant",
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
    // Delegate to the adapter so the multi-project bypass rule has a single
    // source of truth (also used by the generic revision controller).
    const canBypass = getAdapter("constant").canBypassApproval(
      context,
      existing as unknown as Record<string, unknown>,
    );

    // bypassApproval is an explicit admin override — enforce server-side.
    if (bypassApproval && approvalRequired && !canBypass) {
      context.permissions.throwPermissionError();
    }

    // autoPublish must not bypass review that this change genuinely requires.
    // `approvalRequired` is already change-aware (it returns false for changes
    // the review rules don't gate — e.g. metadata when metadata review is off,
    // or an out-of-scope environment), so a remaining `approvalRequired` here
    // means real review is needed: only an admin bypass (or revert bypass) may
    // publish immediately.
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
      // Only record a bypass when the caller used the explicit admin override.
      const isBypass = approvalRequired && bypassApproval;

      // Claim the merge first (CAS-guarded) so a concurrent discard can't orphan
      // a half-applied change; reopen if the live write then fails.
      revision = await context.models.revisions.merge(
        revision.id,
        context.userId,
        { bypass: isBypass },
      );

      try {
        await context.models.constants.update(
          existing,
          fieldsToUpdate as Parameters<
            typeof context.models.constants.update
          >[1],
        );
      } catch (e) {
        try {
          await context.models.revisions.reopen(revision.id, context.userId);
        } catch {
          // ignore — surface the original update error
        }
        throw e;
      }

      await dispatchConstantRevisionEvent(context, revision, {
        type: revision.revertedFrom ? "reverted" : "published",
      });

      return res.status(200).json({ status: 200, revision });
    }
  }

  // Draft path (approval required, no immediate merge). Fire created/updated so
  // the draft lifecycle is observable via webhooks even from the internal UI.
  const updatedExisting =
    wantsDraft && !bypassApproval && !autoPublish && !!revisionId;
  await dispatchConstantRevisionEvent(
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

export const deleteConstant = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const existing = await context.models.constants.getById(req.params.id);
  if (!existing) {
    return context.throwNotFoundError("Constant not found");
  }
  // Require the constant to be archived first. Archive is reversible and flows
  // through the approval system; delete isn't, so this gives users an undo step
  // (mirrors saved groups).
  if (!existing.archived) {
    throw new Error("Constant must be archived before it can be deleted");
  }
  await context.models.constants.delete(existing);
  return res.status(200).json({ status: 200 });
};
