import type { Conflict, JsonPatchOperation, Revision } from "shared/enterprise";
import { isPlainObject, normalizeProposedChanges } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";

type Fragment = Record<string, unknown>;
type Scrub = (fragment: Fragment) => Promise<Fragment>;

// The top-level key an op writes; ops never address anything deeper.
const opKey = (op: JsonPatchOperation) => op.path.split("/")[1] ?? "";

const scrubOps = (ops: unknown, scrub: Scrub) =>
  Promise.all(
    normalizeProposedChanges(ops).map(async (op) => {
      if (!("value" in op)) return op;
      const key = opKey(op);
      return { ...op, value: (await scrub({ [key]: op.value }))[key] };
    }),
  );

// A revision as this viewer may see it: its snapshot, its changes, and the
// copies of both its activity log keeps.
export async function scrubRevisionForViewer(
  context: Context,
  revision: Revision,
): Promise<Revision> {
  const { target } = revision;
  const adapter = getAdapter(target.type);
  if (!adapter.scrubForViewer) return revision;
  const scrub: Scrub = (fragment) =>
    adapter.scrubForViewer!(context, target, fragment);
  return {
    ...revision,
    target: {
      ...target,
      snapshot: await scrub(target.snapshot as Fragment),
      proposedChanges: await scrubOps(target.proposedChanges, scrub),
    } as Revision["target"],
    activityLog: await Promise.all(
      revision.activityLog.map(async (entry) => ({
        ...entry,
        ...(entry.proposedChangesSnapshot && {
          proposedChangesSnapshot: await scrubOps(
            entry.proposedChangesSnapshot,
            scrub,
          ),
        }),
        ...(isPlainObject(entry.targetSnapshot) && {
          targetSnapshot: await scrub(entry.targetSnapshot),
        }),
      })),
    ),
  };
}

// Conflicts echo the base, live and proposed value of each field.
export async function scrubConflictsForViewer(
  context: Context,
  target: Revision["target"],
  conflicts: Conflict[],
): Promise<Conflict[]> {
  const adapter = getAdapter(target.type);
  if (!adapter.scrubForViewer) return conflicts;
  const scrub = async (field: string, value: unknown) =>
    (await adapter.scrubForViewer!(context, target, { [field]: value }))[field];
  return Promise.all(
    conflicts.map(async (conflict) => ({
      ...conflict,
      baseValue: await scrub(conflict.field, conflict.baseValue),
      liveValue: await scrub(conflict.field, conflict.liveValue),
      proposedValue: await scrub(conflict.field, conflict.proposedValue),
    })),
  );
}

// Changes a client sends back, with what it was never shown carried over from
// the state it edited.
export function restoreScrubbedOps(
  type: Revision["target"]["type"],
  base: Fragment,
  ops: JsonPatchOperation[],
): JsonPatchOperation[] {
  const restore = getAdapter(type).restoreScrubbed;
  if (!restore) return ops;
  return ops.map((op) => {
    if (!("value" in op)) return op;
    const key = opKey(op);
    return {
      ...op,
      value: restore({ [key]: base[key] }, { [key]: op.value })[key],
    };
  });
}
