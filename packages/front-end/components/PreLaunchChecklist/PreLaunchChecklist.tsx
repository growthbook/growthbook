import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FaAngleRight, FaCheck } from "react-icons/fa";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import Collapsible from "react-collapsible";
import clsx from "clsx";
import { Box, Flex, Theme } from "@radix-ui/themes";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Badge from "@/ui/Badge";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import Heading from "@/ui/Heading";
import styles from "./PreLaunchChecklist.module.scss";
import { usePreLaunchChecklist } from "./PreLaunchChecklistProvider";
import { CheckListItem, getChecklistItems } from "./PreLaunchChecklistItems";

function PreLaunchChecklistUI({
  experiment,
  mutateExperiment,
  checklist,
  checklistItemsRemaining,
  loading = false,
  allowEditChecklist,
  title = "Pre-Launch Checklist",
  collapsible = true,
  showHeader = true,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => unknown | Promise<unknown>;
  checklistItemsRemaining: number | null;
  checklist: CheckListItem[];
  loading?: boolean;
  className?: string;
  allowEditChecklist?: boolean;
  title?: string;
  collapsible?: boolean;
  showHeader?: boolean;
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

  if (experiment.status !== "draft") return null;

  const contents = loading ? (
    <LoadingSpinner />
  ) : (
    <div>
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
        {!loading && checklistItemsRemaining !== null ? (
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
      {collapsible ? (
        <Frame>
          <Collapsible
            open={!!checklistItemsRemaining}
            transitionTime={100}
            trigger={<div>{header}</div>}
          >
            <div className="mt-2">{contents}</div>
          </Collapsible>
        </Frame>
      ) : (
        <>
          {showHeader && header}
          {contents}
        </>
      )}
    </>
  );
}

function PreLaunchChecklistFeatureExpRule({
  experiment,
  mutateExperiment,
  checklist,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => unknown | Promise<unknown>;
  checklist: CheckListItem[];
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
        loading={false}
        collapsible={false}
        title={experiment.name}
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
  onReady,
}: {
  experiment: ExperimentInterfaceStringDates;
  feature: FeatureInterface;
  mutateExperiment: () => unknown | Promise<unknown>;
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
    />
  );
}

export function PreLaunchChecklistDrawer() {
  const {
    experiment,
    mutateExperiment,
    envs,
    checklist,
    loading,
    checklistItemsRemaining,
    analysisModal,
    setAnalysisModal,
    showSdkForm,
    setShowSdkForm,
    showScheduleModal,
    setShowScheduleModal,
  } = usePreLaunchChecklist();

  const [open, setOpen] = useLocalStorage<boolean>(
    `prelaunchChecklistOpen__${experiment.id}`,
    true,
  );

  useEffect(() => {
    if (checklistItemsRemaining === 0) {
      setOpen(false);
    }
  }, [checklistItemsRemaining, setOpen]);

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
      {showSdkForm && setShowSdkForm ? (
        <InitialSDKConnectionForm
          close={() => setShowSdkForm(false)}
          includeCheck={true}
          cta="Continue"
          goToNextStep={() => {
            setShowSdkForm(false);
          }}
        />
      ) : null}
      {showScheduleModal && setShowScheduleModal ? (
        <EditScheduleModal
          experiment={experiment}
          close={() => setShowScheduleModal(false)}
          mutate={mutateExperiment}
        />
      ) : null}
      <Box className="dark-theme">
        <Theme appearance="dark">
          <Box className={styles.drawer}>
            <Box className={styles.drawerInner}>
              <Box
                className={styles.drawerHeader}
                onClick={() => setOpen(!open)}
                role="button"
              >
                <Flex align="center">
                  <Heading as="h4" size="small">
                    Pre-Launch Checklist
                  </Heading>
                  {checklistItemsRemaining !== null && (
                    <Badge
                      color={checklistItemsRemaining === 0 ? "green" : "amber"}
                      label={
                        checklistItemsRemaining === 0 ? (
                          <FaCheck size={10} />
                        ) : (
                          checklistItemsRemaining.toString()
                        )
                      }
                      radius="full"
                      size="sm"
                      variant="solid"
                      mx="2"
                      style={{
                        minWidth: 20,
                        justifyContent: "center",
                        minHeight: 20,
                      }}
                    />
                  )}
                </Flex>
                {open ? (
                  <PiCaretDown
                    size={15}
                    style={{ color: "var(--violet-11)" }}
                  />
                ) : (
                  <PiCaretUp size={15} style={{ color: "var(--violet-11)" }} />
                )}
              </Box>
              <Box
                className={styles.drawerBody}
                style={open ? undefined : { display: "none" }}
              >
                <PreLaunchChecklistUI
                  experiment={experiment}
                  mutateExperiment={mutateExperiment}
                  checklist={checklist}
                  checklistItemsRemaining={checklistItemsRemaining}
                  loading={loading}
                  allowEditChecklist={true}
                  collapsible={false}
                  showHeader={false}
                />
              </Box>
            </Box>
          </Box>
        </Theme>
      </Box>
    </>
  );
}
