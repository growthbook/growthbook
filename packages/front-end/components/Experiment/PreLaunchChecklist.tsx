import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import React, { ReactElement, useEffect, useMemo, useState } from "react";
import { FaAngleRight, FaCheck } from "react-icons/fa";
import { experimentHasLiveLinkedChanges, hasVisualChanges } from "shared/util";
import { ExperimentLaunchChecklistInterface } from "back-end/types/experimentLaunchChecklist";
import Link from "next/link";
import Collapsible from "react-collapsible";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import useSDKConnections from "@/hooks/useSDKConnections";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import AnalysisForm from "@/components/Experiment/AnalysisForm";

type CheckListItem = {
  display: string | ReactElement;
  status: "complete" | "incomplete";
  tooltip?: string | ReactElement;
  key?: string;
  type: "auto" | "manual";
};

export function PreLaunchChecklist({
  experiment,
  linkedFeatures,
  visualChangesets,
  verifiedConnections,
  mutateExperiment,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
  editTargeting,
  openSetupTab,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  verifiedConnections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  checklistItemsRemaining: number | null;
  setChecklistItemsRemaining: (value: number | null) => void;
  editTargeting?: (() => void) | null;
  openSetupTab?: () => void;
  className?: string;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [showSdkForm, setShowSdkForm] = useState(false);
  const [updatingChecklist, setUpdatingChecklist] = useState(false);
  const showEditChecklistLink =
    hasCommercialFeature("custom-launch-checklist") &&
    permissionsUtil.canManageOrgSettings();
  const canEditExperiment =
    !experiment.archived && permissionsUtil.canUpdateExperiment(experiment, {});

  const { data } = useApi<{ checklist: ExperimentLaunchChecklistInterface }>(
    "/experiments/launch-checklist"
  );
  const { data: sdkConnections } = useSDKConnections();
  const connections = sdkConnections?.connections || [];

  const settings = useOrgSettings();
  const orgStickyBucketing = !!settings.useStickyBucketing;
  const usingStickyBucketing =
    orgStickyBucketing && !experiment.disableStickyBucketing;

  const [analysisModal, setAnalysisModal] = useState(false);

  const isBandit = experiment.type === "multi-armed-bandit";

  //Merge the GB checklist items with org's custom checklist items
  const checklist: CheckListItem[] = useMemo(() => {
    function isChecklistItemComplete(
      // Some items we check completion for automatically, others require users to manually check an item as complete
      type: "auto" | "manual",
      key: string
    ): boolean {
      if (type === "auto") {
        if (!key) return false;
        switch (key) {
          case "hypothesis":
            return !!experiment.hypothesis;
          case "screenshots":
            return experiment.variations.every((v) => !!v.screenshots.length);
          case "description":
            return !!experiment.description;
          case "project":
            return !!experiment.project;
          case "tag":
            return experiment.tags?.length > 0;
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
    const hasLiveLinkedChanges = experimentHasLiveLinkedChanges(
      experiment,
      linkedFeatures
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
            <a className="a" role="button" onClick={openSetupTab}>
              Linked Feature or Visual Editor change
            </a>
          ) : (
            "Linked Feature, Visual Editor change, or URL Redirect"
          )}
          .
        </>
      ),
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
            {canEditExperiment ? (
              <a
                className="a"
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
      });
    }

    // No unpublished feature flags
    if (linkedFeatures.length > 0) {
      const hasFeatureFlagsErrors = linkedFeatures.some(
        (f) =>
          f.state === "draft" ||
          (f.state === "live" &&
            !Object.values(f.environmentStates || {}).some(
              (s) => s === "active"
            ))
      );
      items.push({
        status: hasFeatureFlagsErrors ? "incomplete" : "complete",
        type: "auto",
        display: (
          <>
            Publish and enable all{" "}
            {openSetupTab ? (
              <a className="a" role="button" onClick={openSetupTab}>
                Linked Feature
              </a>
            ) : (
              "Linked Feature"
            )}{" "}
            rules.
          </>
        ),
      });
    }

    // No empty visual changesets
    if (visualChangesets.length > 0) {
      const hasSomeVisualChanges = visualChangesets.some((vc) =>
        hasVisualChanges(vc.visualChanges)
      );
      items.push({
        display: (
          <>
            Add changes in the{" "}
            {openSetupTab ? (
              <a className="a" role="button" onClick={openSetupTab}>
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
      });
    }

    // Experiment has phases
    const hasPhases = experiment.phases.length > 0;
    items.push({
      display: (
        <>
          {editTargeting ? (
            <a
              className="a"
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
      });
    }

    items.push({
      type: "manual",
      key: "sdk-connection",
      status: isChecklistItemComplete("manual", "sdk-connection")
        ? "complete"
        : "incomplete",
      display: (
        <>
          Verify your app is passing both
          <strong> attributes </strong>
          and a <strong> trackingCallback </strong>into the GrowthBook SDK.
        </>
      ),
    });
    items.push({
      type: "manual",
      key: "metrics-tracked",
      status: isChecklistItemComplete("manual", "metrics-tracked")
        ? "complete"
        : "incomplete",
      display: (
        <>
          Verify your app is tracking events for all of the metrics that you
          plan to include in the analysis.
        </>
      ),
    });

    if (data && data.checklist?.tasks?.length > 0) {
      data?.checklist.tasks.forEach((item) => {
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
          });
        }

        if (item.completionType === "auto" && item.propertyKey) {
          items.push({
            display: <>{item.task}</>,
            status: isChecklistItemComplete("auto", item.propertyKey)
              ? "complete"
              : "incomplete",
            type: "auto",
          });
        }
      });
    }
    return items;
  }, [
    data,
    editTargeting,
    experiment,
    linkedFeatures,
    openSetupTab,
    visualChangesets,
    usingStickyBucketing,
    canEditExperiment,
    isBandit,
  ]);

  async function updateTaskStatus(checked: boolean, key: string | undefined) {
    if (!key) return;
    setUpdatingChecklist(true);
    const updatedManualChecklistStatus = Array.isArray(
      experiment.manualLaunchChecklist
    )
      ? [...experiment.manualLaunchChecklist]
      : [];

    const index = updatedManualChecklistStatus.findIndex(
      (task) => task.key === key
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
        checklist.filter((item) => item.status === "incomplete").length
      );
    }
  }, [checklist, data, setChecklistItemsRemaining]);

  if (experiment.status !== "draft") return null;

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

      {analysisModal && (
        <AnalysisForm
          cancel={() => setAnalysisModal(false)}
          experiment={experiment}
          mutate={mutateExperiment}
          phase={experiment.phases.length - 1}
          editDates={true}
          editVariationIds={false}
          editMetrics={true}
          source={"pre-launch-checklist"}
        />
      )}

      <div className="box my-3">
        <Collapsible
          open={true}
          transitionTime={100}
          trigger={
            <div className="d-flex flex-row align-items-center justify-content-between text-dark px-4">
              <h4 className="m-0 py-3">
                Pre-Launch Checklist{" "}
                {data && checklistItemsRemaining !== null ? (
                  <span
                    className={`badge rounded-circle p-1 ${
                      checklistItemsRemaining === 0
                        ? "badge-success"
                        : "badge-warning"
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
                  <span className="text-purple">Edit</span>
                </Link>
              ) : null}
              <FaAngleRight className="chevron" />
            </div>
          }
        >
          <div className="row mx-4 mt-2">
            {!data ? (
              <LoadingSpinner />
            ) : (
              <ul style={{ fontSize: "1.1em" }} className="ml-0 pl-0">
                {checklist.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      listStyleType: "none",
                      marginLeft: 0,
                      marginBottom: 6,
                    }}
                  >
                    <div className="d-flex align-items-center">
                      <Tooltip
                        body="GrowthBook calculates the completion of this task automatically."
                        shouldDisplay={item.type === "auto"}
                      >
                        <input
                          type="checkbox"
                          disabled={
                            !canEditExperiment ||
                            (item.type === "manual" && updatingChecklist) ||
                            (item.type === "auto" &&
                              item.status === "incomplete")
                          }
                          className="ml-0 pl-0 mr-2 "
                          checked={item.status === "complete"}
                          onChange={async (e) => {
                            updateTaskStatus(e.target.checked, item.key);
                          }}
                        />
                      </Tooltip>
                      <span
                        style={{
                          textDecoration:
                            item.status === "complete"
                              ? "line-through"
                              : "none",
                        }}
                      >
                        {item.display}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Collapsible>
        {data && !verifiedConnections.length ? (
          <div className="alert alert-danger mx-3">
            <strong>
              Before you can run an experiment, you need to integrate GrowthBook
              into your app.{" "}
            </strong>
            {connections.length > 0 ? (
              <Link href="/sdks">Manage SDK Connections</Link>
            ) : (
              <a
                className="a"
                role="button"
                onClick={() => setShowSdkForm(true)}
              >
                Add SDK Connection
              </a>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
