import { ConfigInterface } from "shared/types/config";
import { isConfigLocked } from "shared/util";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { BadRequestError } from "back-end/src/util/errors";
import { ensureLiveRevisionExists } from "back-end/src/revisions/util";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { makeBlockingGate } from "back-end/src/revisions/publishGates";

type Context = ReqContext | ApiReqContext;

// Hard publish gate for a locked config. Every path that would advance the live
// state past the pinned revision (publish, revert-to-publish, direct update,
// scheduled publish, archive) calls this BEFORE claiming a merge, so a blocked
// publish leaves the draft open rather than stranding a revision "merged" but
// unapplied. Creating/editing drafts is intentionally still allowed. The only
// escape is an explicit unlock (requires bypassApprovalChecks) — no inline bypass.
export function assertConfigNotLocked(config: ConfigInterface): void {
  if (isConfigLocked(config)) {
    throw new BadRequestError(
      `Config "${config.key}" is locked at revision v${config.lock?.version}. ` +
        "Unlock it (requires the bypassApprovalChecks permission) before publishing.",
    );
  }
}

// The gate form of the lock check, shared by the publish and archive handlers
// and the bulk publisher. No override flag — the only escape is the unlock
// route (assertConfigNotLocked stays as the write-path backstop).
export function collectConfigLockGate(config: ConfigInterface): PublishGate[] {
  if (!isConfigLocked(config)) return [];
  return [
    makeBlockingGate({
      type: "config-locked",
      messages: [
        `Locked at revision v${config.lock?.version}. Unlock it first.`,
      ],
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "unlock",
        method: "POST",
        path: `/configs/${config.key}/unlock`,
      },
    }),
  ];
}

// The revision to pin when locking: the config's current live (latest merged)
// revision. Backfills a baseline live revision first for configs that never went
// through the revision workflow, so there is always something to pin.
export async function resolveConfigLockTarget(
  context: Context,
  config: ConfigInterface,
): Promise<{ revisionId: string; version: number }> {
  await ensureLiveRevisionExists(
    context,
    "config",
    config as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );
  const live = await context.models.revisions.getLatestMergedByTarget(
    "config",
    config.id,
  );
  if (!live || (live.version ?? null) === null) {
    throw new BadRequestError(
      "Could not determine the config's live revision to lock.",
    );
  }
  return { revisionId: live.id, version: live.version as number };
}
