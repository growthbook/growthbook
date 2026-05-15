import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { FaAngleRight, FaCheck } from "react-icons/fa";
import { experimentHasLiveLinkedChanges, hasVisualChanges } from "shared/util";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { PiArrowSquareOut } from "react-icons/pi";
import Collapsible from "react-collapsible";
import clsx from "clsx";
import Link from "@/ui/Link";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Badge from "@/ui/Badge";
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Features/RevisionStatusBadge";
import styles from "./PreLaunchChecklist.module.scss";

export type CheckListItem = {
  display: string | ReactElement;
  status: "complete" | "incomplete";
  tooltip?: string | ReactElement;
  key?: string;
  type: "auto" | "manual";
  required: boolean;
  // Items that can't be bypassed via "Start Anyway" (merge conflicts,
  // missing approvals, unrelated draft edits) — auto-publish would fail.
  hardBlock?: boolean;
  warning?: string;
  hideDescription?: boolean;
  // Custom subtext shown below the label, overriding the default auto/manual
  // hint. Hidden when `hideDescription` is true or the item is complete.
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
            <a className="a link-purple" role="button" onClick={openSetupTab}>
              Linked Feature or Visual Editor change
            </a>
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
              <a
                className="a link-purple"
                role="button"
                onClick={() => setAnalysisModal(true)}
              >
                Choose
              </a>
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

      // When the draft also has unrelated changes, the FF-page publish flow
      // already covers approval — skip the redundant approval row.
      linkedFeatures
        .filter((f) => f.pendingApproval && !f.hasUnrelatedDraftChanges)
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
            !f.hasMergeConflict,
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
              <a className="a link-purple" role="button" onClick={openSetupTab}>
                Visual Editor
              </a>
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
          <a
            className="a link-purple"
            role="button"
            onClick={() => {
              editTargeting();
              track("Edit targeting", { source: "experiment-start-banner" });
            }}
          >
            Configure
          </a>
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
          <a
            className="a link-purple"
            role="button"
            onClick={() => setShowSdkForm(true)}
          >
            Add SDK Connection
          </a>
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
        if (isBandit && item.propertyKey === "hypothesis") {
          return;
        }
        items.push({
          display: <>{item.task}</>,
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

export function PreLaunchChecklistUI({
  experiment,
  mutateExperiment,
  checklist,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
  setChecklistHardBlockerCount,
  analysisModal,
  setAnalysisModal,
  allowEditChecklist,
  title = "Pre-Launch Checklist",
  collapsible = true,
  envs,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => unknown | Promise<unknown>;
  checklistItemsRemaining: number | null;
  checklist: CheckListItem[];
  setChecklistItemsRemaining: (value: number | null) => void;
  setChecklistHardBlockerCount?: (value: number) => void;
  className?: string;
  analysisModal?: boolean;
  setAnalysisModal?: (value: boolean) => void;
  allowEditChecklist?: boolean;
  title?: string;
  collapsible?: boolean;
  envs: string[];
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [updatingChecklist, setUpdatingChecklist] = useState(false);
  const showEditChecklistLink =
    allowEditChecklist &&
    hasCommercialFeature("custom-launch-checklist") &&
    permissionsUtil.canManageOrgSettings();
  const canEditExperiment =
    !experiment.archived && permissionsUtil.canUpdateExperiment(experiment, {});

  const { data } = useApi<{ checklist: ExperimentLaunchChecklistInterface }>(
    `/experiment/${experiment.id}/launch-checklist`,
  );

  async function updateTaskStatus(checked: boolean, key: string | undefined) {
    if (!key) return;
    setUpdatingChecklist(true);
    const updatedManualChecklistStatus = Array.isArray(
      experiment.manualLaunchChecklist,
    )
      ? [...experiment.manualLaunchChecklist]
      : [];

    const index = updatedManualChecklistStatus.findIndex(
      (task) => task.key === key,
    );
    if (index === -1) {
      updatedManualChecklistStatus.push({
        key,
        status: checked ? "complete" : "incomplete",
      });
    } else {
      updatedManualChecklistStatus[index] = {
        key,
        status: checked ? "complete" : "incomplete",
      };
    }
    try {
      // Updates the experiment's manual checklist and logs the event to the audit log
      await apiCall(`/experiment/${experiment.id}/launch-checklist`, {
        method: "PUT",
        body: JSON.stringify({
          checklist: updatedManualChecklistStatus,
        }),
      });
    } catch (e) {
      setUpdatingChecklist(false);
    }
    setUpdatingChecklist(false);
    mutateExperiment();
  }

  useEffect(() => {
    if (data && checklist.length > 0) {
      const incomplete = checklist.filter(
        (item) => item.status === "incomplete",
      );
      setChecklistItemsRemaining(incomplete.length);
      setChecklistHardBlockerCount?.(
        incomplete.filter((item) => item.hardBlock).length,
      );
    }
  }, [
    checklist,
    data,
    setChecklistItemsRemaining,
    setChecklistHardBlockerCount,
  ]);

  if (experiment.status !== "draft") return null;

  const contents = !data ? (
    <LoadingSpinner />
  ) : (
    <div className="pt-2">
      {checklist.map((item, i) => {
        // Auto items can't be toggled by the user.
        const isReadonly = item.type === "auto";
        const isReadonlyIncomplete = isReadonly && item.status === "incomplete";
        return (
          <div key={i} className="mb-2">
            <Checkbox
              value={item.status === "complete"}
              setValue={(checked) => {
                if (item.type === "auto") return;
                if (item.type === "manual" && updatingChecklist) return;
                updateTaskStatus(!!checked, item.key);
              }}
              disabled={!canEditExperiment}
              disabledMessage={
                !canEditExperiment
                  ? "You don't have permission to mark this as completed"
                  : undefined
              }
              containerClassName={clsx({
                [styles.readonly]: isReadonly,
                [styles.readonlyIncomplete]: isReadonlyIncomplete,
              })}
              label={
                <span
                  style={{
                    textDecoration:
                      item.status === "complete" ? "line-through" : "none",
                  }}
                >
                  {item.display}
                  {!item.required && (
                    <small className="text-muted ml-1">(optional)</small>
                  )}
                </span>
              }
              description={
                item.hideDescription || item.status === "complete"
                  ? undefined
                  : item.description !== undefined
                    ? item.description
                    : item.type === "auto"
                      ? "GrowthBook will mark this as completed automatically when you finish the task."
                      : "You must manually mark this as complete. GrowthBook is unable to detect this automatically."
              }
              error={item.warning}
              errorLevel="warning"
            />
          </div>
        );
      })}
    </div>
  );

  const header = (
    <div className="d-flex flex-row align-items-center justify-content-between text-dark">
      <h4 className="mb-0">
        {title}{" "}
        {data && checklistItemsRemaining !== null ? (
          <span
            className={`badge rounded-circle p-1 ${
              checklistItemsRemaining === 0 ? "badge-success" : "badge-warning"
            } mx-2 my-0`}
            style={{ minWidth: 22 }}
          >
            {checklistItemsRemaining === 0 ? (
              <FaCheck size={10} />
            ) : (
              checklistItemsRemaining
            )}
          </span>
        ) : null}
      </h4>
      <div className="flex-1" />
      {showEditChecklistLink ? (
        <Link
          className="mr-3 link-purple"
          href={"/settings?editCheckListModal=true"}
          onClick={(e) => e.stopPropagation()}
        >
          Edit
        </Link>
      ) : null}
      {collapsible && <FaAngleRight className="chevron" />}
    </div>
  );

  return (
    <>
      {analysisModal && setAnalysisModal ? (
        <AnalysisForm
          cancel={() => setAnalysisModal(false)}
          experiment={experiment}
          mutate={mutateExperiment}
          phase={experiment.phases.length - 1}
          editDates={true}
          editVariationIds={false}
          editMetrics={true}
          source={"pre-launch-checklist"}
          envs={envs}
        />
      ) : null}
      {collapsible ? (
        <Frame>
          <Collapsible
            open={!!checklistItemsRemaining}
            transitionTime={100}
            trigger={<div className="">{header}</div>}
          >
            <div className="mt-2">{contents}</div>
          </Collapsible>
        </Frame>
      ) : (
        <>
          {header}
          {contents}
        </>
      )}
    </>
  );
}

export function PreLaunchChecklistFeatureExpRule({
  experiment,
  mutateExperiment,
  checklist,
  envs,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => unknown | Promise<unknown>;
  checklist: CheckListItem[];
  envs: string[];
}) {
  const failedRequired = checklist.some(
    (item) => item.status === "incomplete" && item.required,
  );

  return (
    <>
      <PreLaunchChecklistUI
        experiment={experiment}
        mutateExperiment={mutateExperiment}
        checklist={checklist}
        checklistItemsRemaining={
          checklist.filter((item) => item.status === "incomplete").length
        }
        setChecklistItemsRemaining={() => {}}
        collapsible={false}
        title={experiment.name}
        envs={envs}
      />
      {failedRequired ? (
        <Callout status="error" mb="3">
          Please complete all required items before starting your experiment.
        </Callout>
      ) : (
        <Callout status="success" mb="3">
          All required items are complete. The experiment is ready to start.
        </Callout>
      )}{" "}
    </>
  );
}

// Checklist for the DraftModal / RequestReviewModal publish flow.
// Fetches the project-aware /experiment/:id/launch-checklist endpoint so
// project-scoped custom tasks match what's shown on the experiment page.
export function PreLaunchChecklistForDraft({
  experiment,
  feature,
  mutateExperiment,
  envs,
  onReady,
}: {
  experiment: ExperimentInterfaceStringDates;
  feature: FeatureInterface;
  mutateExperiment: () => unknown | Promise<unknown>;
  envs: string[];
  // Called when failedRequired or loading changes so the parent can gate submit.
  onReady?: (failedRequired: boolean, loading: boolean) => void;
}) {
  const { data: checklistData, isLoading: checklistLoading } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(`/experiment/${experiment.id}/launch-checklist`);

  // Fetch linked feature info so other features' merge conflicts surface in the
  // checklist. The current feature is replaced by a synthetic "live" entry so
  // the "Add at least one linked change" item stays green.
  const { data: experimentData, isLoading: expLoading } = useApi<{
    linkedFeatures: LinkedFeatureInfo[];
  }>(`/experiment/${experiment.id}`);

  const { data: sdkConnectionsData } = useSDKConnections();
  const connections = (sdkConnectionsData?.connections ?? []).filter(
    (c) => !c.projects.length || c.projects.includes(experiment.project || ""),
  );

  // Synthetic entry for the current feature: treat as "live" so the checklist
  // passes the "Add at least one linked change" item. pendingApproval is
  // intentionally omitted — approval is handled by the modal flow itself.
  const syntheticLinkedFeature: LinkedFeatureInfo = useMemo(
    () => ({
      feature,
      state: "live",
      values: [],
      valuesFrom: "",
      inconsistentValues: false,
      rulesAbove: false,
      environmentStates: {},
    }),
    [feature],
  );

  // Combine: synthetic entry for the current feature + real info for all other
  // linked features (so their hasMergeConflict / pendingApproval states show).
  const linkedFeatures: LinkedFeatureInfo[] = useMemo(() => {
    const others = (experimentData?.linkedFeatures ?? []).filter(
      (f) => f.feature.id !== feature.id,
    );
    return [syntheticLinkedFeature, ...others];
  }, [experimentData, feature.id, syntheticLinkedFeature]);

  const isLoading = checklistLoading || expLoading;

  const checklist = useMemo(
    () =>
      getChecklistItems({
        experiment,
        linkedFeatures,
        visualChangesets: [],
        checklist: checklistData?.checklist,
        checkLinkedChanges: true,
        connections,
      }),
    [experiment, linkedFeatures, checklistData, connections],
  );

  const failedRequired = checklist.some(
    (item) => item.status === "incomplete" && item.required,
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableOnReady = useCallback(onReady ?? (() => {}), []);
  useEffect(() => {
    stableOnReady(failedRequired, !!isLoading);
  }, [failedRequired, isLoading, stableOnReady]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <PreLaunchChecklistFeatureExpRule
      experiment={experiment}
      mutateExperiment={mutateExperiment}
      checklist={checklist}
      envs={envs}
    />
  );
}

export function PreLaunchChecklist({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  mutateExperiment,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
  setChecklistHardBlockerCount,
  editTargeting,
  openSetupTab,
  envs,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  checklistItemsRemaining: number | null;
  setChecklistItemsRemaining: (value: number | null) => void;
  setChecklistHardBlockerCount?: (value: number) => void;
  editTargeting?: (() => void) | null;
  openSetupTab?: () => void;
  className?: string;
  envs: string[];
}) {
  const permissionsUtil = usePermissionsUtil();
  const canEditExperiment =
    !experiment.archived && permissionsUtil.canUpdateExperiment(experiment, {});

  const { data } = useApi<{ checklist: ExperimentLaunchChecklistInterface }>(
    `/experiment/${experiment.id}/launch-checklist`,
  );

  const [showSdkForm, setShowSdkForm] = useState(false);

  const [analysisModal, setAnalysisModal] = useState(false);

  //Merge the GB checklist items with org's custom checklist items
  const checklist: CheckListItem[] = useMemo(() => {
    return getChecklistItems({
      experiment,
      linkedFeatures,
      visualChangesets,
      checklist: data?.checklist,
      setAnalysisModal: canEditExperiment ? setAnalysisModal : undefined,
      editTargeting,
      openSetupTab,
      checkLinkedChanges: true,
      connections,
      setShowSdkForm,
    });
  }, [
    data,
    editTargeting,
    experiment,
    linkedFeatures,
    openSetupTab,
    visualChangesets,
    canEditExperiment,
    connections,
  ]);

  return (
    <>
      {showSdkForm && (
        <InitialSDKConnectionForm
          close={() => setShowSdkForm(false)}
          includeCheck={true}
          cta="Continue"
          goToNextStep={() => {
            setShowSdkForm(false);
          }}
        />
      )}
      <PreLaunchChecklistUI
        {...{
          experiment,
          mutateExperiment,
          checklist,
          checklistItemsRemaining,
          setChecklistItemsRemaining,
          setChecklistHardBlockerCount,
          analysisModal,
          setAnalysisModal,
          allowEditChecklist: true,
          envs,
        }}
      />
    </>
  );
}
