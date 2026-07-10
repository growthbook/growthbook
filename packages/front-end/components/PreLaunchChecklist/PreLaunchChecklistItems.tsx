import { ReactElement } from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { experimentHasLiveLinkedChanges, hasVisualChanges } from "shared/util";
import track from "@/services/track";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";

export type CheckListItem = {
  display: string | ReactElement;
  status: "complete" | "incomplete";
  tooltip?: string | ReactElement;
  key?: string;
  type: "auto" | "manual";
  required: boolean;
  /**
   * Items that can't be bypassed via "Start Anyway" (merge conflicts, missing
   * approvals, unrelated draft edits) — auto-publish would fail.
   */
  hardBlock?: boolean;
  warning?: string;
  hideDescription?: boolean;
  /**
   * Custom subtext shown below the label, overriding the default auto/manual
   * hint. Hidden when `hideDescription` is true or the item is complete.
   */
  description?: string | ReactElement;
};

export function getChecklistItems({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  editTargeting,
  openSetupTab,
  setAnalysisModal,
  setShowSdkForm,
  checklist,
  checkLinkedChanges,
  setShowScheduleModal,
  /** When publishing from a feature draft page, waive the unrelated-edits gate
   *  for that feature — the user is explicitly reviewing the full draft. */
  publishingFeatureId,
  showAnalysisSetupItems,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  editTargeting?: (() => void) | null;
  openSetupTab?: () => void;
  className?: string;
  setAnalysisModal?: (value: boolean) => void;
  setShowSdkForm?: (value: boolean) => void;
  checklist?: ExperimentLaunchChecklistInterface;
  checkLinkedChanges: boolean;
  setShowScheduleModal?: (value: boolean) => void;
  publishingFeatureId?: string;
  showAnalysisSetupItems?: boolean;
}) {
  const isBandit = experiment.type === "multi-armed-bandit";

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

  if (showAnalysisSetupItems && !isBandit) {
    const hasDatasource = !!experiment.datasource;
    const hasAssignmentTable = !!experiment.exposureQueryId;

    items.push({
      type: "auto",
      key: "datasource",
      required: true,
      status: hasDatasource ? "complete" : "incomplete",
      display: (
        <>
          {setAnalysisModal ? (
            <Link onClick={() => setAnalysisModal(true)}>Select</Link>
          ) : (
            "Select"
          )}{" "}
          a Data Source for this experiment
        </>
      ),
    });

    items.push({
      type: "auto",
      key: "exposureQuery",
      required: true,
      status: hasAssignmentTable ? "complete" : "incomplete",
      display: (
        <>
          {setAnalysisModal ? (
            <Link onClick={() => setAnalysisModal(true)}>Select</Link>
          ) : (
            "Select"
          )}{" "}
          an Experiment Assignment Table
        </>
      ),
    });

    if (hasDatasource && hasAssignmentTable) {
      items.push({
        type: "auto",
        key: "goalMetric",
        required: true,
        status:
          (experiment.goalMetrics?.length ?? 0) > 0 ? "complete" : "incomplete",
        display: (
          <>
            {setAnalysisModal ? (
              <Link onClick={() => setAnalysisModal(true)}>Add</Link>
            ) : (
              "Add"
            )}{" "}
            at least one goal metric
          </>
        ),
      });
    }
  }

  if (checkLinkedChanges) {
    const hasLiveLinkedChanges = experimentHasLiveLinkedChanges(
      experiment,
      linkedFeatures,
    );
    const hasLinkedChanges =
      linkedFeatures.some((f) => f.state === "live" || f.state === "draft") ||
      experiment.hasVisualChangesets ||
      experiment.hasURLRedirects;
    items.push({
      display: (
        <>
          Add at least one{isBandit && " live"}{" "}
          {openSetupTab &&
          ((isBandit && !hasLiveLinkedChanges) ||
            (!isBandit && hasLinkedChanges)) ? (
            <Link onClick={openSetupTab}>
              Linked Feature or Visual Editor change
            </Link>
          ) : (
            "Linked Feature, Visual Editor change, or URL Redirect"
          )}
        </>
      ),
      required: true,
      status:
        (isBandit && hasLiveLinkedChanges) || (!isBandit && hasLinkedChanges)
          ? "complete"
          : "incomplete",
      type: "auto",
    });

    if (isBandit) {
      items.push({
        display: (
          <>
            {setAnalysisModal ? (
              <Link onClick={() => setAnalysisModal(true)}>Choose</Link>
            ) : (
              "Choose"
            )}{" "}
            a Decision Metric and update cadence
          </>
        ),
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
            status: "incomplete",
            type: "auto",
            required: true,
            hardBlock: true,
            hideDescription: true,
            display: (
              <>
                Resolve merge conflict in{" "}
                <Link
                  href={`/features/${f.feature.id}${f.draftRevisionVersion != null ? `?v=${f.draftRevisionVersion}` : ""}`}
                  target="_blank"
                >
                  {f.feature.id}
                  <PiArrowSquareOut className="ml-1" />
                </Link>{" "}
                before this experiment can start
              </>
            ),
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
            status:
              f.draftRevisionStatus === "approved" ? "complete" : "incomplete",
            type: "auto",
            required: true,
            hardBlock: true,
            hideDescription: true,
            display: (
              <>
                Approve the feature draft revision in{" "}
                <Link
                  href={`/features/${f.feature.id}${f.draftRevisionVersion != null ? `?v=${f.draftRevisionVersion}` : ""}`}
                  target="_blank"
                >
                  {f.feature.id}
                  <PiArrowSquareOut className="ml-1" />
                </Link>{" "}
                {f.draftRevisionStatus && (
                  <Badge
                    label={revisionStatusLabel(f.draftRevisionStatus)}
                    color={revisionStatusColor(f.draftRevisionStatus)}
                    radius="full"
                    ml="1"
                  />
                )}
              </>
            ),
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
            status: "incomplete",
            type: "auto",
            required: true,
            hardBlock: true,
            display: (
              <>
                The feature draft revision in{" "}
                <Link
                  href={`/features/${f.feature.id}${f.draftRevisionVersion != null ? `?v=${f.draftRevisionVersion}` : ""}`}
                  target="_blank"
                >
                  {f.feature.id}
                  <PiArrowSquareOut className="ml-1" />
                </Link>{" "}
                contains additional changes unrelated to this experiment.
              </>
            ),
            description: (
              <>
                Either <em style={{ fontWeight: 700 }}>remove these changes</em>{" "}
                from the draft to auto-publish the feature or{" "}
                <em style={{ fontWeight: 700 }}>manually publish this draft</em>
                .
              </>
            ),
          });
        });

      const latestVariations = getLatestPhaseVariations(experiment);
      linkedFeatures
        .filter((f) => f.state !== "discarded" && f.state !== "archived")
        .forEach((f) => {
          const configuredVariationIds = new Set(
            f.values.map((v) => v.variationId),
          );
          const hasMissingValues = latestVariations.some(
            (v) => !configuredVariationIds.has(v.id),
          );
          if (hasMissingValues) {
            items.push({
              status: "incomplete",
              type: "auto",
              required: true,
              hideDescription: true,
              display: (
                <>
                  Fill in missing variation values for{" "}
                  <Link href={`/features/${f.feature.id}`} target="_blank">
                    {f.feature.id}
                    <PiArrowSquareOut className="ml-1" />
                  </Link>
                </>
              ),
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
        display: (
          <>
            Add changes in the{" "}
            {openSetupTab ? (
              <Link onClick={openSetupTab}>Visual Editor</Link>
            ) : (
              "Visual Editor"
            )}
          </>
        ),
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
    display: (
      <>
        {editTargeting ? (
          <Link
            onClick={() => {
              editTargeting();
              track("Edit targeting", { source: "experiment-start-banner" });
            }}
          >
            Configure
          </Link>
        ) : (
          "Configure"
        )}{" "}
        variation assignment and targeting behavior
      </>
    ),
    status: hasPhases ? "complete" : "incomplete",
    type: "auto",
    required: true,
  });

  const verifiedConnections = connections.some((c) => c.connected);
  items.push({
    type: "auto",
    key: "has-connection",
    status: connections.length ? "complete" : "incomplete",
    display: (
      <>
        Integrate GrowthBook into your app by adding an SDK Connection{" "}
        {!setShowSdkForm && !verifiedConnections ? (
          <Link href="/sdks">Manage SDK Connections</Link>
        ) : connections.length === 0 && setShowSdkForm ? (
          <Link onClick={() => setShowSdkForm(true)}>Add SDK Connection</Link>
        ) : null}
      </>
    ),
    required: true,
    warning:
      connections.length > 0 && !verifiedConnections
        ? "An SDK Connection exists, but it has not been verified to be working yet"
        : undefined,
  });

  if (checklist?.tasks?.length) {
    checklist.tasks.forEach((item) => {
      if (item.completionType === "manual") {
        items.push({
          type: "manual",
          key: item.task,
          status: isChecklistItemComplete("manual", item.task)
            ? "complete"
            : "incomplete",
          display: item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.task}
            </a>
          ) : (
            <>{item.task}</>
          ),
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
        items.push({
          display:
            item.propertyKey === "schedule" ? (
              <>
                {setShowScheduleModal ? (
                  <Link onClick={() => setShowScheduleModal(true)}>
                    Add scheduled start date
                  </Link>
                ) : (
                  "Add scheduled start date"
                )}{" "}
                to experiment.
              </>
            ) : (
              <>{item.task}</>
            ),
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
  }
  return items;
}
