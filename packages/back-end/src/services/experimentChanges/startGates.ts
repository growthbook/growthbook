import { bypassApprovalPermission } from "shared/permissions";
import { PENDING_APPROVAL_ITEM_PREFIX } from "shared/validators";
import {
  evaluatePublishGates,
  makeBlockingGate,
  type BypassedGate,
  type PublishGate,
  type PublishGateClearance,
  type SkippedGate,
} from "back-end/src/revisions/publishGates";
import type { StartChecklistItemStatus } from "./changeExperimentStatus";

// `key` is the checklist row, or `rampLocked:<featureId>`; `featureId` is the
// flag whose authority decides it.
export type StartGate = PublishGate & { key: string; featureId?: string };

// Rows on a linked flag's draft, and the draft route that resolves each.
const FLAG_BLOCKERS: {
  prefix: string;
  type: string;
  action: string | null;
}[] = [
  {
    prefix: PENDING_APPROVAL_ITEM_PREFIX,
    type: "approval-required",
    action: "request-review",
  },
  { prefix: "mergeConflict:", type: "merge-conflict", action: "rebase" },
  {
    prefix: "unrelatedDraftChanges:",
    type: "unrelated-draft-changes",
    action: null,
  },
  { prefix: "publishPermission:", type: "permission-denied", action: null },
];

const draftRoute = (
  featureId: string,
  version: number | undefined,
  action: string | null,
) =>
  version === undefined || action === null
    ? null
    : {
        action,
        method: "POST",
        path: `/features/${featureId}/revisions/${version}/${action}`,
      };

export function startChecklistGates(
  experimentId: string,
  items: StartChecklistItemStatus[],
  draftVersions: Map<string, number>,
): StartGate[] {
  return items
    .filter((item) => item.status === "incomplete")
    .map((item): StartGate => {
      const blocker = FLAG_BLOCKERS.find(({ prefix }) =>
        item.key.startsWith(prefix),
      );
      const { featureId } = item;
      if (blocker && featureId) {
        return {
          ...makeBlockingGate({
            type: blocker.type,
            messages: [item.reason],
            requiresPermission:
              blocker.type === "approval-required"
                ? bypassApprovalPermission("feature")
                : null,
            resolution: draftRoute(
              featureId,
              draftVersions.get(featureId),
              blocker.action,
            ),
          }),
          key: item.key,
          featureId,
        };
      }
      return {
        key: item.key,
        ...(featureId ? { featureId } : {}),
        type: "checklist-item",
        severity: item.hardBlock ? "blocker" : "warning",
        messages: [item.reason],
        override: item.hardBlock ? null : "skipChecklist",
        requiresPermission: null,
        resolution: item.manual
          ? {
              action: "complete",
              method: "POST",
              path: `/experiments/${experimentId}/start-checklist/manual/complete`,
            }
          : null,
      };
    });
}

export function rampLockedGate(featureId: string, message: string): StartGate {
  return {
    ...makeBlockingGate({
      type: "ramp-locked",
      messages: [message],
      requiresPermission: bypassApprovalPermission("feature"),
    }),
    key: `rampLocked:${featureId}`,
    featureId,
  };
}

// Each flag's gates are judged on that flag's authority, as publishing its
// draft judges them.
export function evaluateStartGates(
  gates: StartGate[],
  {
    skipChecklist,
    canBypassFlag,
    restApiBypassesReviews,
  }: {
    skipChecklist: boolean;
    canBypassFlag: (featureId: string) => boolean;
    restApiBypassesReviews: boolean;
  },
): {
  blocking: StartGate[];
  bypassed: BypassedGate[];
  skipped: (SkippedGate & { key: string })[];
} {
  const blocking: StartGate[] = [];
  const bypassed: BypassedGate[] = [];
  const skipped: (SkippedGate & { key: string })[] = [];
  for (const gate of gates) {
    const clearance: PublishGateClearance = {
      ignoreWarnings: false,
      skipChecklist,
      skipSchemaValidation: false,
      skipHooks: false,
      bypassApprovalPermission:
        !!gate.featureId && canBypassFlag(gate.featureId),
      restApiBypassesReviews,
      canForceMergeStaleBase: false,
    };
    const result = evaluatePublishGates([gate], clearance);
    if (result.blocking.length) blocking.push(gate);
    bypassed.push(...result.bypassed);
    skipped.push(...result.skipped.map((s) => ({ ...s, key: gate.key })));
  }
  return { blocking, bypassed, skipped };
}
