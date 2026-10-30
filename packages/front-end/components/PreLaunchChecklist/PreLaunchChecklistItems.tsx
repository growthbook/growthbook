import { ReactElement } from "react";
import {
  getLaunchChecklistItems,
  type LaunchChecklistItem,
  mergeConflictItems,
  missingVariationValueItems,
  unrelatedDraftChangeItems,
} from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { hasPendingScheduledStart, startBypassCovers } from "shared/util";
import track from "@/services/track";
import type { AnalysisFormFocus } from "@/components/Experiment/AnalysisForm";
import { isBypassableStartItem } from "./checklistSummary";

export type ChecklistAction =
  | { onClick: () => void }
  | { href: string; external?: boolean };

export type CheckListItem = {
  key: string;
  // Plain copy: the row makes it a link when there's an action.
  display: string;
  action?: ChecklistAction;
  status: "complete" | "incomplete";
  type: "auto" | "manual";
  required: boolean;
  // Blocks the start outright, since auto-publish would fail. Only an admin's
  // start bypass waives any: the approval rows (isBypassableStartItem).
  hardBlock?: boolean;
  warning?: string;
  description?: string | ReactElement;
  // What a manual task's status is stored under.
  manualKey?: string;
  // The Feature Flag an approval row waits on.
  featureId?: string;
};

// Opens the flag in a new tab at `version`: its draft by default, null for
// the flag itself.
export function linkedFeatureAction(
  f: LinkedFeatureInfo,
  version = f.draftRevisionVersion ?? null,
): ChecklistAction {
  return {
    href: `/features/${f.feature.id}${version !== null ? `?v=${version}` : ""}`,
    external: true,
  };
}

export function blockingRow(
  row: Pick<CheckListItem, "key" | "display" | "action" | "description">,
): CheckListItem {
  return {
    ...row,
    status: "incomplete",
    type: "auto",
    required: true,
    hardBlock: true,
  };
}

// A shared checklist item as a row, opening its flag when it's about one.
function toRow(
  item: LaunchChecklistItem,
  linkedFeatures: LinkedFeatureInfo[],
): CheckListItem {
  const flag = item.featureId
    ? linkedFeatures.find((f) => f.feature.id === item.featureId)
    : undefined;
  return {
    key: item.customTask
      ? `custom:${item.customTask.index}:${item.key}`
      : item.key,
    display: item.label,
    status: item.status,
    type: item.manual ? "manual" : "auto",
    required: item.required,
    hardBlock: item.hardBlock,
    featureId: item.featureId,
    ...(item.manual ? { manualKey: item.key } : {}),
    ...(flag
      ? {
          action: linkedFeatureAction(flag, item.revision),
        }
      : {}),
  };
}

// Rows a linked flag raises wherever it goes live: an experiment's start or a
// Contextual Bandit's.
export function mergeConflictRows(
  linkedFeatures: LinkedFeatureInfo[],
): CheckListItem[] {
  return mergeConflictItems(linkedFeatures).map((item) =>
    toRow(item, linkedFeatures),
  );
}

export function unrelatedDraftChangeRows(
  linkedFeatures: LinkedFeatureInfo[],
  publishingFeatureId?: string,
): CheckListItem[] {
  return unrelatedDraftChangeItems(linkedFeatures, publishingFeatureId).map(
    (item) => toRow(item, linkedFeatures),
  );
}

export function missingVariationValueRows(
  linkedFeatures: LinkedFeatureInfo[],
  variations: { id: string }[],
): CheckListItem[] {
  return missingVariationValueItems(linkedFeatures, variations).map((item) =>
    toRow(item, linkedFeatures),
  );
}

export function getChecklistItems({
  experiment,
  linkedFeatures,
  visualChangesets,
  urlRedirects = [],
  connections,
  checklist,
  /** When publishing from a feature draft page, waive the unrelated-edits gate
   *  for that feature — the user is explicitly reviewing the full draft. */
  publishingFeatureId,
  // In-page fixes. Callers leave out the ones this viewer can't make.
  openAnalysisSettings,
  openImplementation,
  editTargeting,
  editSchedule,
  createSdkConnection,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects?: URLRedirectInterface[];
  connections: SDKConnectionInterface[];
  checklist?: ExperimentLaunchChecklistInterface;
  publishingFeatureId?: string;
  openAnalysisSettings?: ((focus: AnalysisFormFocus | null) => void) | null;
  openImplementation?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editSchedule?: (() => void) | null;
  createSdkConnection?: (() => void) | null;
}): CheckListItem[] {
  const startApproved = hasPendingScheduledStart(experiment);
  const onClick = (fn?: (() => void) | null): ChecklistAction | undefined =>
    fn ? { onClick: fn } : undefined;
  const openSettingsOn = (focus: AnalysisFormFocus | null) =>
    onClick(openAnalysisSettings && (() => openAnalysisSettings(focus)));
  const verifiedConnections = connections.some((c) => c.connected);

  return getLaunchChecklistItems({
    experiment,
    linkedFeatures,
    visualChangesets,
    urlRedirects,
    sdkConnections: connections,
    checklist,
    publishingFeatureId,
  }).map((item): CheckListItem => {
    const row = toRow(item, linkedFeatures);
    if (item.customTask) {
      const isSchedule =
        !item.manual && item.customTask.propertyKey === "schedule";
      return {
        ...row,
        action: isSchedule
          ? onClick(editSchedule)
          : item.customTask.url
            ? { href: item.customTask.url, external: true }
            : undefined,
      };
    }
    if (isBypassableStartItem(item)) {
      const draft = linkedFeatures.find(
        (f) => f.feature.id === item.featureId,
      )?.pendingDraft;
      // The confirmed start publishes it past its approval.
      return draft &&
        item.featureId &&
        startBypassCovers(experiment, item.featureId, draft)
        ? {
            ...row,
            status: "complete",
            display: `Approval bypassed for the Feature Flag draft for ${item.featureId}`,
          }
        : row;
    }
    switch (item.key) {
      case "datasource":
      case "exposureQuery":
        return { ...row, action: openSettingsOn(item.key) };
      case "goalMetric":
        return { ...row, action: openSettingsOn("goalMetrics") };
      case "banditGoalMetric":
        return { ...row, action: openSettingsOn(null) };
      case "linkedChanges":
      case "visualEditorChanges":
        return { ...row, action: onClick(openImplementation) };
      case "targeting":
      case "variationWeights":
        return {
          ...row,
          // A confirmed start fixes targeting until it's unscheduled.
          action: onClick(
            editTargeting && !startApproved
              ? () => {
                  editTargeting();
                  track("Edit targeting", {
                    source: "experiment-start-banner",
                  });
                }
              : null,
          ),
        };
      case "sdkConnection":
        return {
          ...row,
          action: (connections.length
            ? undefined
            : onClick(createSdkConnection)) ?? { href: "/sdks" },
          warning:
            connections.length > 0 && !verifiedConnections
              ? "An SDK Connection exists, but it has not been verified to be working yet"
              : undefined,
        };
      case "visualEditorSdk":
      case "urlRedirectSdk":
        return { ...row, action: { href: "/sdks" } };
      default:
        return row;
    }
  });
}
