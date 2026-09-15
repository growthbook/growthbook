import {
  ApiCustomHook,
  CustomHookEntityType,
  CustomHookInterface,
  CustomHookType,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { Context } from "back-end/src/models/BaseModel";
import { NotFoundError } from "back-end/src/util/errors";
import {
  countAuditByEntity,
  findAuditByEntity,
} from "back-end/src/models/AuditModel";

export type CustomHookVersion = {
  auditId: string;
  event: string;
  dateCreated: string;
  userName?: string;
  userEmail?: string;
  customHook: ApiCustomHook;
};

// Default page size when a caller (e.g. the in-app modal) doesn't paginate.
const DEFAULT_HISTORY_LIMIT = 100;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asDate = (v: unknown): string | undefined =>
  typeof v === "string" ? v : v instanceof Date ? v.toISOString() : undefined;

// The audit detail snapshot is the raw stored doc (dates serialized to strings),
// so map it explicitly rather than through the model's `toApiInterface`, which
// expects live Date objects.
function snapshotToApi(s: Record<string, unknown>): ApiCustomHook {
  return {
    id: asString(s.id),
    name: asString(s.name),
    hook: s.hook as ApiCustomHook["hook"],
    code: asString(s.code),
    enabled: !!s.enabled,
    projects: Array.isArray(s.projects) ? (s.projects as string[]) : [],
    entityType: (s.entityType as CustomHookEntityType) ?? undefined,
    entityId: typeof s.entityId === "string" ? s.entityId : undefined,
    incrementalChangesOnly:
      typeof s.incrementalChangesOnly === "boolean"
        ? s.incrementalChangesOnly
        : undefined,
    lastSuccess: asDate(s.lastSuccess),
    lastFailure: asDate(s.lastFailure),
    dateCreated: asDate(s.dateCreated) ?? "",
    dateUpdated: asDate(s.dateUpdated) ?? "",
  };
}

function parseSnapshot(details?: string): Record<string, unknown> | null {
  if (!details) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  // Every create/update event records the resulting state as `post`.
  const post =
    parsed && typeof parsed === "object"
      ? (parsed as { post?: unknown }).post
      : null;
  return post && typeof post === "object"
    ? (post as Record<string, unknown>)
    : null;
}

// Each create/update audit event is one version (its resulting state). Newest
// first; paginated at the DB level (limit/skip) rather than loaded in full.
export async function getCustomHookVersions(
  context: Context,
  id: string,
  {
    limit = DEFAULT_HISTORY_LIMIT,
    offset = 0,
  }: { limit?: number; offset?: number } = {},
): Promise<{ versions: CustomHookVersion[]; total: number }> {
  const hook = await context.models.customHooks.getById(id);
  if (!hook) throw new NotFoundError("Custom hook not found");

  const [audits, total] = await Promise.all([
    findAuditByEntity(context.org.id, "customHook", id, {
      sort: { dateCreated: -1 },
      limit,
      skip: offset,
    }),
    countAuditByEntity(context.org.id, "customHook", id),
  ]);

  const versions: CustomHookVersion[] = [];
  for (const a of audits) {
    const snapshot = parseSnapshot(a.details);
    if (!snapshot) continue;
    versions.push({
      auditId: a.id,
      event: a.event,
      dateCreated: asDate(a.dateCreated) ?? "",
      userName: "name" in a.user ? a.user.name : undefined,
      userEmail: "email" in a.user ? a.user.email : undefined,
      customHook: snapshotToApi(snapshot),
    });
  }
  return { versions, total };
}

// Restore the hook to the state captured by a prior audit event. This goes
// through the normal update path, so it enforces permissions + validation and
// writes a fresh audit entry (full snapshot) — the revert itself is never lost.
export async function revertCustomHookToVersion(
  context: Context,
  id: string,
  auditId: string,
): Promise<CustomHookInterface> {
  const hook = await context.models.customHooks.getById(id);
  if (!hook) throw new NotFoundError("Custom hook not found");

  // Fetch the exact target event by id (still org + entity scoped) so revert
  // works for any version, not just those within the recent history window.
  const [target] = await findAuditByEntity(
    context.org.id,
    "customHook",
    id,
    { limit: 1 },
    { id: auditId },
  );
  const snapshot = target && parseSnapshot(target.details);
  if (!snapshot) {
    throw new NotFoundError(
      "Could not find a snapshot to restore for that version",
    );
  }

  const updates: UpdateProps<CustomHookInterface> = {
    name: asString(snapshot.name),
    hook: snapshot.hook as CustomHookType,
    code: asString(snapshot.code),
    enabled: !!snapshot.enabled,
    projects: Array.isArray(snapshot.projects)
      ? (snapshot.projects as string[])
      : [],
    // null (not undefined) clears an entity scope; matches the update-body contract.
    entityType: (snapshot.entityType as CustomHookEntityType | null) ?? null,
    entityId: typeof snapshot.entityId === "string" ? snapshot.entityId : null,
    incrementalChangesOnly:
      typeof snapshot.incrementalChangesOnly === "boolean"
        ? snapshot.incrementalChangesOnly
        : undefined,
  };

  return context.models.customHooks.revertUpdate(hook, updates);
}
