import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import React, { ReactElement, useEffect, useMemo, useState } from "react";
import { FaAngleRight, FaCheck } from "react-icons/fa";
import { experimentHasLiveLinkedChanges, hasVisualChanges } from "shared/util";
import { getLatestPhaseVariations } from "shared/experiments";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import Link from "next/link";
import Collapsible from "react-collapsible";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";

export type CheckListItem = {
  display: string | ReactElement;
  status: "complete" | "incomplete";
  tooltip?: string | ReactElement;
  key?: string;
  type: "auto" | "manual";
  required: boolean;
  warning?: string;
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
  usingStickyBucketing,
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
  usingStickyBucketing?: boolean;
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
          .
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
            a Decision Metric and update cadence.
          </>
        ),
        status: experiment.goalMetrics?.[0] ? "complete" : "incomplete",
        type: "auto",
        required: true,
      });
    }

    // No unpublished feature flags
    if (linkedFeatures.length > 0) {
      const hasFeatureFlagsErrors = linkedFeatures.some(
        (f) =>
          f.state === "draft" ||
          (f.state === "live" &&
            !Object.values(f.environmentStates || {}).some(
              (s) => s === "active",
            )),
      );
      items.push({
        status: hasFeatureFlagsErrors ? "incomplete" : "complete",
        type: "auto",
        display: (
          <>
            Publish and enable all{" "}
            {openSetupTab ? (
              <a className="a link-purple" role="button" onClick={openSetupTab}>
                Linked Feature
              </a>
            ) : (
              "Linked Feature"
            )}{" "}
            rules.
          </>
        ),
        required: false,
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
            .
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
        variation assignment and targeting behavior.
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
        Integrate GrowthBook into your app by adding an SDK Connection.{" "}
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

  if (isBandit) {
    items.push({
      type: "auto",
      status: usingStickyBucketing ? "complete" : "incomplete",
      display: (
        <>
          <Link href="/settings">Enable Sticky Bucketing</Link> for your
          organization and verify it is implemented properly in your codebase.
        </>
      ),
      required: true,
    });
  }

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
      setChecklistItemsRemaining(
        checklist.filter((item) => item.status === "incomplete").length,
      );
    }
  }, [checklist, data, setChecklistItemsRemaining]);

  if (experiment.status !== "draft") return null;

  const contents = !data ? (
    <LoadingSpinner />
  ) : (
    <div className="pt-2">
      {checklist.map((item, i) => (
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
              item.status === "incomplete" && item.type === "auto"
                ? "GrowthBook will mark this as completed automatically when you finish the task."
                : item.status === "incomplete"
                  ? "You must manually mark this as complete. GrowthBook is unable to detect this automatically."
                  : undefined
            }
            error={item.warning}
            errorLevel="warning"
          />
        </div>
      ))}
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

export function PreLaunchChecklist({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  mutateExperiment,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
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

  const settings = useOrgSettings();
  const orgStickyBucketing = !!settings.useStickyBucketing;
  const usingStickyBucketing =
    orgStickyBucketing && !experiment.disableStickyBucketing;

  const [analysisModal, setAnalysisModal] = useState(false);

  //Merge the GB checklist items with org's custom checklist items
  const checklist: CheckListItem[] = useMemo(() => {
    return getChecklistItems({
      experiment,
      linkedFeatures,
      visualChangesets,
      usingStickyBucketing,
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
    usingStickyBucketing,
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
          analysisModal,
          setAnalysisModal,
          allowEditChecklist: true,
          envs,
        }}
      />
    </>
  );
}
