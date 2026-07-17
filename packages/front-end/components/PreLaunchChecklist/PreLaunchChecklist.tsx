import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { FaCheck } from "react-icons/fa";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import clsx from "clsx";
import { Box, Flex, Theme } from "@radix-ui/themes";
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
import Badge from "@/ui/Badge";
import Switch from "@/ui/Switch";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import Heading from "@/ui/Heading";
import styles from "./PreLaunchChecklist.module.scss";
import { usePreLaunchChecklist } from "./PreLaunchChecklistProvider";
import { CheckListItem, getChecklistItems } from "./PreLaunchChecklistItems";

function PreLaunchChecklistUI({
  experiment,
  mutateExperiment,
  checklist,
  loading = false,
  allowEditChecklist,
  title = "Pre-Launch Checklist",
  showHeader = true,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => unknown | Promise<unknown>;
  checklist: CheckListItem[];
  loading?: boolean;
  className?: string;
  allowEditChecklist?: boolean;
  title?: ReactNode;
  showHeader?: boolean;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [updatingChecklist, setUpdatingChecklist] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const showEditChecklistLink =
    allowEditChecklist &&
    hasCommercialFeature("custom-launch-checklist") &&
    permissionsUtil.canManageOrgSettings();
  const canEditExperiment =
    !experiment.archived && permissionsUtil.canUpdateExperiment(experiment, {});
  const checklistItemsRemaining = checklist.filter(
    (item) => item.status === "incomplete",
  ).length;

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

  const incompleteItems = checklist.filter(
    (item) => item.status === "incomplete",
  );
  const completeItems = checklist.filter((item) => item.status === "complete");

  const renderItem = (item: CheckListItem, key: string | number) => {
    const isReadonly = item.type === "auto";
    const isReadonlyIncomplete = isReadonly && item.status === "incomplete";
    return (
      <Box key={key} mb="2">
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
          checkboxTooltip={
            isReadonlyIncomplete
              ? "Automatically detected and marked as 'complete' when task is finished"
              : undefined
          }
          containerClassName={clsx({
            [styles.readonly]: isReadonly,
            [styles.readonlyIncomplete]: isReadonlyIncomplete,
          })}
          label={
            <span
              className={clsx({
                [styles.completedLabel]: item.status === "complete",
              })}
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
              : item.description
          }
          error={item.warning}
          errorLevel="warning"
        />
      </Box>
    );
  };

  const itemsBelowToggle = showCompleted
    ? incompleteItems.length > 0 || completeItems.length > 0
    : incompleteItems.length > 0;

  const contents = loading ? (
    <LoadingSpinner />
  ) : (
    <Box className={styles.drawerBodyInner}>
      {completeItems.length > 0 && (
        <Box
          className={styles.showCompletedToggle}
          style={{ marginBottom: itemsBelowToggle ? "19px" : "var(--space-2)" }}
        >
          <Switch
            value={showCompleted}
            onChange={setShowCompleted}
            label="Show completed"
          />
        </Box>
      )}
      <Box className={styles.itemsScroll}>
        {incompleteItems.map((item, i) => renderItem(item, i))}
        {showCompleted &&
          completeItems.map((item, i) => renderItem(item, `complete-${i}`))}
      </Box>
    </Box>
  );

  const header = (
    <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-3">
      <h4 className="mb-0">
        {title}{" "}
        {!loading ? (
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
    </div>
  );

  return (
    <>
      {showHeader && header}
      {contents}
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
        loading={false}
        title={
          <Link
            href={`/experiment/${experiment.id}`}
            target="_blank"
            rel="noreferrer"
          >
            {experiment.name}
          </Link>
        }
      />
      {failedRequired ? (
        <Callout status="error" my="3">
          Please complete all required items before starting your experiment.
        </Callout>
      ) : (
        <Callout status="success" my="3">
          All required items are complete. The experiment is ready to start.
        </Callout>
      )}{" "}
    </>
  );
}

export function PreLaunchChecklistForDraftFeature({
  experiment,
  feature,
  mutateExperiment,
  onReady,
}: {
  experiment: ExperimentInterfaceStringDates;
  feature: FeatureInterface;
  mutateExperiment: () => unknown | Promise<unknown>;
  onReady?: (failedRequired: boolean, loading: boolean) => void;
}) {
  const { data: checklistData, isLoading: checklistLoading } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(`/experiment/${experiment.id}/launch-checklist`);

  const { data: experimentData, isLoading: expLoading } = useApi<{
    linkedFeatures: LinkedFeatureInfo[];
  }>(`/experiment/${experiment.id}`);

  const { data: sdkConnectionsData } = useSDKConnections();
  const connections = (sdkConnectionsData?.connections ?? []).filter(
    (c) => !c.projects.length || c.projects.includes(experiment.project || ""),
  );

  const isLoading = checklistLoading || expLoading;

  const checklist = useMemo(
    () =>
      getChecklistItems({
        experiment,
        linkedFeatures: experimentData?.linkedFeatures ?? [],
        visualChangesets: [],
        checklist: checklistData?.checklist,
        checkLinkedChanges: true,
        connections,
        publishingFeatureId: feature.id,
      }),
    [experiment, experimentData, checklistData, connections, feature.id],
  );

  const failedRequired = checklist.some(
    (item) => item.status === "incomplete" && item.required,
  );

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.(failedRequired, !!isLoading);
  }, [failedRequired, isLoading]);

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

  const [open, setOpen] = useState(false);

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
      <Box className="dark-theme prelaunch-checklist-drawer">
        <Theme appearance="dark">
          <Box className={styles.drawer}>
            <Box className={styles.drawerInner}>
              <Box
                className={styles.drawerHeader}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(!open);
                }}
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
                  loading={loading}
                  allowEditChecklist={true}
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
