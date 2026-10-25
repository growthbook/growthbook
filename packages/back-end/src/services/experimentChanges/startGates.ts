import { bypassApprovalPermission } from "shared/permissions";
import { PENDING_APPROVAL_ITEM_PREFIX } from "shared/validators";
import type { FeatureInterface } from "shared/types/feature";
import {
  evaluatePublishGates,
  type BypassedGate,
  type PublishGate,
  type PublishGateClearance,
  type SkippedGate,
} from "back-end/src/revisions/publishGates";
import type { StartChecklistItemStatus } from "./changeExperimentStatus";

// A start's checks on the publish-gate model. The checklist row (or `rampLocked:`
// flag) it stands for is `key`; `featureId` names the flag whose authority
// decides it.
export type StartGate = PublishGate & { key: string; featureId?: string };

// Rows on a linked flag's draft: resolved there, or for approval, waived by
// that flag's authority.
const FLAG_BLOCKERS: [prefix: string, type: string][] = [
  [PENDING_APPROVAL_ITEM_PREFIX, "approval-required"],
  ["mergeConflict:", "merge-conflict"],
  ["unrelatedDraftChanges:", "unrelated-draft-changes"],
  ["publishPermission:", "permission-denied"],
];

const draftRoute = (
  featureId: string,
  version: number | undefined,
  action: string,
) =>
  version === undefined
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
      const blocker = FLAG_BLOCKERS.find(([prefix]) =>
        item.key.startsWith(prefix),
      );
      if (blocker) {
        const featureId = item.key.slice(blocker[0].length);
        const version = draftVersions.get(featureId);
        return {
          key: item.key,
          featureId,
          type: blocker[1],
          severity: "blocker",
          messages: [item.reason],
          override: null,
          requiresPermission:
            blocker[1] === "approval-required"
              ? bypassApprovalPermission("feature")
              : null,
          resolution:
            blocker[1] === "approval-required"
              ? draftRoute(featureId, version, "request-review")
              : blocker[1] === "merge-conflict"
                ? draftRoute(featureId, version, "rebase")
                : null,
        };
      }
      return {
        key: item.key,
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
    key: `rampLocked:${featureId}`,
    featureId,
    type: "ramp-locked",
    severity: "blocker",
    messages: [message],
    override: null,
    requiresPermission: bypassApprovalPermission("feature"),
    resolution: null,
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
    canBypassFlag: (feature: FeatureInterface | undefined) => boolean;
    restApiBypassesReviews: boolean;
  },
  features: Map<string, FeatureInterface>,
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
        !!gate.featureId && canBypassFlag(features.get(gate.featureId)),
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
