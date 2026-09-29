import { ReactElement } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import {
  experimentHasLiveLinkedChanges,
  getImplementationType,
  getManagedValueProblems,
  hasStartReadyManagedFlag,
  hasVisualChanges,
  isManagedByExperiment,
  PENDING_APPROVAL_ITEM_PREFIX,
  type ManagedValueProblem,
} from "shared/util";
import track from "@/services/track";
import VariationLabel from "@/ui/VariationLabel";
import { STALE_VALUES_ITEM_PREFIX } from "./checklistSummary";

export type ChecklistAction =
  | { onClick: () => void }
  | { href: string; external?: boolean };

export type CheckListItem = {
  // Unique per row.
  key: string;
  // Plain copy: the row makes it a link when there's an action.
  display: string | ReactElement;
  action?: ChecklistAction;
  status: "complete" | "incomplete";
  type: "auto" | "manual";
  required: boolean;
  /**
   * Blocks the start outright (merge conflicts, missing approvals, unrelated
   * draft edits), since auto-publish would fail. Only an admin's start bypass
   * waives any: the approval and stale-values rows (isBypassableStartItem).
   */
  hardBlock?: boolean;
  warning?: string;
  description?: string | ReactElement;
  // What a manual task's status is stored under.
  manualKey?: string;
  // The Feature Flag an approval or stale-values row waits on.
  featureId?: string;
};

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
  editVariationValues,
  openManagedApproval,
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
  openAnalysisSettings?: (() => void) | null;
  openImplementation?: (() => void) | null;
  editVariationValues?: (() => void) | null;
  openManagedApproval?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editSchedule?: (() => void) | null;
  createSdkConnection?: (() => void) | null;
}): CheckListItem[] {
  const isBandit = experiment.type === "multi-armed-bandit";

  // An approved start locks the editors these would open; links still work.
  const startApproved = experiment.nextScheduledStatusUpdate?.type === "start";
  const onClick = (fn?: (() => void) | null): ChecklistAction | undefined =>
    fn && !startApproved ? { onClick: fn } : undefined;
  const featureLink = (
    f: LinkedFeatureInfo,
    draft = true,
  ): ChecklistAction => ({
    href: `/features/${f.feature.id}${draft && (f.draftRevisionVersion ?? null) !== null ? `?v=${f.draftRevisionVersion}` : ""}`,
    external: true,
  });

  function isChecklistItemComplete(
    // Some items we check completion for automatically, others require users to manually check an item as complete
    type: "auto" | "manual",
    key: string,
    customFieldId?: string,
  ): boolean {
    if (type === "auto") {
      if (!key) return false;
      switch (key) {
        case "hypothesis":
          return !!experiment.hypothesis;
        case "screenshots":
          return getLatestPhaseVariations(experiment).every(
            (v) => !!v.screenshots.length,
          );
        case "description":
          return !!experiment.description;
        case "project":
          return !!experiment.project;
        case "tag":
          return experiment.tags?.length > 0;
        case "customField":
          if (customFieldId) {
            const expField = experiment?.customFields?.[customFieldId];
            return !!expField;
          }
          return false;
        case "prerequisiteTargeting": {
          const prerequisites =
            experiment.phases?.[experiment.phases.length - 1]?.prerequisites;
          return !!prerequisites && prerequisites.length > 0;
        }
        case "schedule":
          return !!experiment.statusUpdateSchedule?.startAt;
      }
    }

    const manualChecklistStatus = experiment.manualLaunchChecklist || [];

    const index = manualChecklistStatus.findIndex((task) => task.key === key);

    if (index === -1 || !manualChecklistStatus[index]) {
      return false;
    }

    return manualChecklistStatus[index].status === "complete";
  }
  const items: CheckListItem[] = [];

  if (!isBandit) {
    const hasDatasource = !!experiment.datasource;
    const hasAssignmentTable = !!experiment.exposureQueryId;

    items.push({
      type: "auto",
      key: "datasource",
      required: true,
      status: hasDatasource ? "complete" : "incomplete",
      display: "Select a Data Source",
      action: onClick(openAnalysisSettings),
    });

    items.push({
      type: "auto",
      key: "exposureQuery",
      required: true,
      status: hasAssignmentTable ? "complete" : "incomplete",
      display: "Select an experiment assignment table",
      action: onClick(openAnalysisSettings),
    });

    if (hasDatasource && hasAssignmentTable) {
      items.push({
        type: "auto",
        key: "goalMetric",
        required: true,
        status:
          (experiment.goalMetrics?.length ?? 0) > 0 ? "complete" : "incomplete",
        display: "Add at least one goal metric",
        action: onClick(openAnalysisSettings),
      });
    }
  }

  const isManaged = (f: LinkedFeatureInfo) =>
    isManagedByExperiment(f.feature, experiment.id);
  const implementationType = getImplementationType(experiment);
  const valuesMode =
    linkedFeatures.some(isManaged) || implementationType === "values";

  if (implementationType !== "none") {
    // Publishing this flag's draft is what takes it live.
    const publishesLinkedFeature =
      !!publishingFeatureId &&
      linkedFeatures.some(
        (f) => f.feature.id === publishingFeatureId && f.state === "draft",
      );
    const hasLiveLinkedChanges =
      experimentHasLiveLinkedChanges(experiment, linkedFeatures) ||
      hasStartReadyManagedFlag(experiment.id, linkedFeatures) ||
      publishesLinkedFeature;
    const hasLinkedChanges =
      linkedFeatures.some((f) => f.state === "live" || f.state === "draft") ||
      experiment.hasVisualChangesets ||
      experiment.hasURLRedirects;
    const linkedChangesDone =
      (isBandit && hasLiveLinkedChanges) || (!isBandit && hasLinkedChanges);
    items.push({
      key: "linkedChanges",
      display: valuesMode
        ? "Add variation values"
        : `Add a${isBandit ? " live" : ""} linked Feature Flag, Visual Editor change, or URL redirect`,
      action: onClick(valuesMode ? editVariationValues : openImplementation),
      required: true,
      // The header won't start a Bandit without one. Only the experiment page
      // blocks on it: elsewhere, publishing is how the change goes live.
      hardBlock: isBandit && !publishingFeatureId,
      status: linkedChangesDone ? "complete" : "incomplete",
      type: "auto",
    });

    if (isBandit) {
      items.push({
        key: "banditGoalMetric",
        display: "Choose a decision metric and update cadence",
        action: onClick(openAnalysisSettings),
        status: experiment.goalMetrics?.[0] ? "complete" : "incomplete",
        type: "auto",
        required: true,
      });
    }

    if (linkedFeatures.length > 0) {
      // Merge conflicts, missing approvals, and unrelated draft changes are
      // hard blockers — auto-publish would reject or silently push unreviewed
      // edits. Surfaced as separate items so multiple issues on one draft
      // aren't hidden behind a single row.
      linkedFeatures
        .filter((f) => f.state === "draft" && f.hasMergeConflict)
        .forEach((f) => {
          items.push({
            key: `mergeConflict:${f.feature.id}`,
            status: "incomplete",
            type: "auto",
            required: true,
            hardBlock: true,
            ...(isManaged(f)
              ? {
                  display:
                    "Resolve the merge conflict in this experiment's variation values",
                  // Resolved by discarding the draft, which only its review offers.
                  action: onClick(openManagedApproval ?? editVariationValues),
                }
              : {
                  display: `Resolve the merge conflict in ${f.feature.id}`,
                  action: featureLink(f),
                }),
          });
        });

      // Starting would fail on it; the review is where the values update.
      linkedFeatures
        .filter(
          (f) =>
            isManaged(f) &&
            !!f.pendingDraft?.rebaseRequired &&
            !f.pendingDraft.hasMergeConflict,
        )
        .forEach((f) => {
          items.push({
            key: `${STALE_VALUES_ITEM_PREFIX}${f.feature.id}`,
            featureId: f.feature.id,
            status: "incomplete",
            type: "auto",
            required: true,
            hardBlock: true,
            display: "Update the variation values from live",
            action: onClick(openManagedApproval),
          });
        });

      // Publishing this feature's own draft (from its Review & Publish page) is
      // what approves it, so skip the self-referential approval row. Drafts with
      // unrelated changes are likewise covered by that publish flow.
      linkedFeatures
        .filter(
          (f) =>
            f.pendingApproval &&
            !f.hasUnrelatedDraftChanges &&
            f.feature.id !== publishingFeatureId,
        )
        .forEach((f) => {
          items.push({
            key: `${PENDING_APPROVAL_ITEM_PREFIX}${f.feature.id}`,
            featureId: f.feature.id,
            status:
              (f.draftApprovalSatisfied ?? f.draftRevisionStatus === "approved")
                ? "complete"
                : "incomplete",
            type: "auto",
            required: true,
            hardBlock: true,
            ...(isManaged(f)
              ? {
                  // Nothing reaches reviewers until the author sends it.
                  display:
                    f.draftRevisionStatus === "draft"
                      ? "Request a review of the variation values"
                      : "Review and approve the variation values",
                  action: onClick(openManagedApproval),
                }
              : {
                  display: `Approve the Feature Flag draft for ${f.feature.id}`,
                  action: featureLink(f),
                }),
          });
        });

      linkedFeatures
        .filter(
          (f) =>
            f.state === "draft" &&
            f.hasUnrelatedDraftChanges &&
            !f.hasMergeConflict &&
            f.feature.id !== publishingFeatureId,
        )
        .forEach((f) => {
          items.push({
            key: `unrelatedDraftChanges:${f.feature.id}`,
            status: "incomplete",
            type: "auto",
            required: true,
            hardBlock: true,
            display: `The ${f.feature.id} draft has changes unrelated to this experiment`,
            description:
              "Remove them from the draft to auto-publish the Feature Flag, or publish the draft manually.",
            action: featureLink(f),
          });
        });

      const latestVariations = getLatestPhaseVariations(experiment);
      linkedFeatures
        .filter((f) => f.state !== "discarded" && f.state !== "archived")
        .forEach((f) => {
          if (isManaged(f)) {
            const variationList = (list: ManagedValueProblem[]) =>
              list.map((p, i) => (
                <span key={p.variationId}>
                  {i > 0 ? ", " : ""}
                  <VariationLabel
                    number={latestVariations.findIndex(
                      (v) => v.id === p.variationId,
                    )}
                    name={p.variationName}
                    size="sm"
                  />
                </span>
              ));
            const problems = getManagedValueProblems({
              variations: latestVariations,
              values: f.pendingDraft?.values ?? f.values,
              valueType: f.pendingDraft?.valueType ?? f.feature.valueType,
            });
            const missing = problems.filter((p) => p.problem === "missing");
            const malformed = problems.filter((p) => p.problem === "malformed");
            if (missing.length) {
              items.push({
                key: `missingVariationValues:${f.feature.id}`,
                status: "incomplete",
                type: "auto",
                required: true,
                display: (
                  <>Add a variation value for {variationList(missing)}</>
                ),
                action: onClick(editVariationValues),
              });
            }
            if (malformed.length) {
              items.push({
                key: `malformedVariationValues:${f.feature.id}`,
                status: "incomplete",
                type: "auto",
                required: true,
                hardBlock: true,
                display: (
                  <>Fix the variation value for {variationList(malformed)}</>
                ),
                description: malformed
                  .map((p) =>
                    p.detail
                      ? `${p.variationName}: ${p.detail}`
                      : p.variationName,
                  )
                  .join("; "),
                action: onClick(editVariationValues),
              });
            }
            return;
          }
          const configuredVariationIds = new Set(
            f.values.map((v) => v.variationId),
          );
          const hasMissingValues = latestVariations.some(
            (v) => !configuredVariationIds.has(v.id),
          );
          if (hasMissingValues) {
            items.push({
              key: `missingVariationValues:${f.feature.id}`,
              status: "incomplete",
              type: "auto",
              required: true,
              display: `Fill in missing variation values for ${f.feature.id}`,
              action: featureLink(f, false),
            });
          }
        });
    }

    // No empty visual changesets
    if (visualChangesets.length > 0) {
      const hasSomeVisualChanges = visualChangesets.some((vc) =>
        hasVisualChanges(vc.visualChanges),
      );
      items.push({
        key: "visualEditorChanges",
        display: "Add changes in the Visual Editor",
        action: onClick(openImplementation),
        status: hasSomeVisualChanges ? "complete" : "incomplete",
        type: "auto",
        // An A/A test is a valid experiment that doesn't have changes, so don't make this required
        required: false,
      });
    }
  }

  // Experiment has phases
  const hasPhases = experiment.phases.length > 0;
  items.push({
    key: "targeting",
    display: "Configure variation assignment and targeting",
    action: onClick(
      editTargeting
        ? () => {
            editTargeting();
            track("Edit targeting", { source: "experiment-start-banner" });
          }
        : null,
    ),
    status: hasPhases ? "complete" : "incomplete",
    type: "auto",
    required: true,
    // The start refuses a draft with no phase to run.
    hardBlock: !hasPhases,
  });

  const verifiedConnections = connections.some((c) => c.connected);
  const addConnection = connections.length
    ? undefined
    : onClick(createSdkConnection);
  items.push({
    type: "auto",
    key: "sdkConnection",
    status: connections.length ? "complete" : "incomplete",
    display: "Add an SDK Connection",
    action: addConnection ?? { href: "/sdks" },
    required: true,
    warning:
      connections.length > 0 && !verifiedConnections
        ? "An SDK Connection exists, but it has not been verified to be working yet"
        : undefined,
  });

  const hasAnyVisualChanges = visualChangesets.some((vc) =>
    hasVisualChanges(vc.visualChanges),
  );
  if (hasAnyVisualChanges) {
    items.push({
      type: "auto",
      key: "visualEditorSdk",
      status: connections.some((c) => c.includeVisualExperiments)
        ? "complete"
        : "incomplete",
      display:
        "Enable Visual Editor experiments on an SDK Connection for this Project",
      action: { href: "/sdks" },
      required: true,
    });
  }

  if (urlRedirects.length > 0) {
    items.push({
      type: "auto",
      key: "urlRedirectSdk",
      status: connections.some((c) => c.includeRedirectExperiments)
        ? "complete"
        : "incomplete",
      display:
        "Enable URL redirect experiments on an SDK Connection for this Project",
      action: { href: "/sdks" },
      required: true,
    });
  }

  checklist?.tasks?.forEach((item, i) => {
    // Task text can repeat, or match a built-in key.
    const key = `custom:${i}:${item.task}`;
    if (item.completionType === "manual") {
      items.push({
        type: "manual",
        key,
        manualKey: item.task,
        status: isChecklistItemComplete("manual", item.task)
          ? "complete"
          : "incomplete",
        display: item.task,
        action: item.url ? { href: item.url, external: true } : undefined,
        required: true,
      });
    }

    if (item.completionType === "auto" && item.propertyKey) {
      if (
        isBandit &&
        (item.propertyKey === "hypothesis" || item.propertyKey === "schedule")
      ) {
        return;
      }
      const isSchedule = item.propertyKey === "schedule";
      items.push({
        key,
        display: isSchedule ? "Add a scheduled start date" : item.task,
        action: isSchedule ? onClick(editSchedule) : undefined,
        status: isChecklistItemComplete(
          "auto",
          item.propertyKey,
          item.customFieldId,
        )
          ? "complete"
          : "incomplete",
        type: "auto",
        required: true,
      });
    }
  });
  return items;
}
