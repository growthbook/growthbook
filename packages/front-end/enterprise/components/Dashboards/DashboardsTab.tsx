import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, { useCallback, useEffect, useState } from "react";
import {
  DashboardInterface,
  DashboardUpdateSchedule,
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockData,
  getBlockData,
} from "shared/enterprise";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { withErrorBoundary } from "@sentry/nextjs";
import Button from "@/ui/Button";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useExperimentDashboards } from "@/hooks/useDashboards";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { createTemporaryDashboard } from "@/pages/product-analytics/dashboards/new";
import DashboardsTabMoreMenu from "./DashboardsTabMoreMenu";
import DashboardEditor from "./DashboardEditor";
import DashboardSnapshotProvider from "./DashboardSnapshotProvider";
import DashboardModal from "./DashboardModal";
import DashboardWorkspace from "./DashboardWorkspace";
import DashboardSelector from "./DashboardSelector";

export type CreateDashboardArgs = {
  method: "POST";
  dashboardId?: never;
  data: {
    title: string;
    editLevel: DashboardInterface["editLevel"];
    shareLevel: DashboardInterface["shareLevel"];
    userId: string;
    enableAutoUpdates: boolean;
    updateSchedule?: DashboardUpdateSchedule;
    blocks?: DashboardBlockData<DashboardBlockInterface>[];
    projects?: string[];
  };
};
export type UpdateDashboardArgs = {
  method: "PUT";
  dashboardId: string;
  data: Partial<{
    title: string;
    blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
    editLevel: DashboardInterface["editLevel"];
    userId: string;
    shareLevel: DashboardInterface["shareLevel"];
    enableAutoUpdates: boolean;
    updateSchedule?: DashboardUpdateSchedule;
    projects?: string[];
  }>;
};
export type SubmitDashboard<
  T extends CreateDashboardArgs | UpdateDashboardArgs,
> = (args: T) => Promise<void>;

export const autoUpdateDisabledMessage =
  "Your organization settings have disabled automatic refreshing of experiment results";
interface Props {
  experiment: ExperimentInterfaceStringDates;
  initialDashboardId: string;
  isTabActive: boolean;
  showDashboardView?: boolean;
  updateTabPath: (path: string) => void;
  switchToExperimentView?: () => void;
  mutateExperiment?: () => void;
}

function DashboardsTab({
  experiment,
  initialDashboardId,
  isTabActive,
  showDashboardView = false,
  updateTabPath,
  switchToExperimentView,
  mutateExperiment,
}: Props) {
  const [dashboardId, setDashboardId] = useState(initialDashboardId);
  useEffect(() => {
    if (initialDashboardId) {
      setDashboardId(initialDashboardId);
    }
  }, [initialDashboardId]);
  const {
    dashboards,
    mutateDashboards,
    loading: loadingDashboards,
  } = useExperimentDashboards(experiment.id);
  const defaultDashboard = dashboards.find((dash) => dash.isDefault);
  const [dashboardMounted, setDashboardMounted] = useState(false);

  // Adds an extra render cycle for other useEffects to trigger before rendering children
  useEffect(() => {
    setDashboardMounted(!loadingDashboards);
  }, [loadingDashboards]);

  useEffect(() => {
    if (!dashboardId && dashboards.length > 0) {
      setDashboardId(defaultDashboard?.id ?? dashboards[0].id);
    }
  }, [dashboardId, dashboards, defaultDashboard]);

  useEffect(() => {
    if (isTabActive) {
      updateTabPath(dashboardId);
    }
  }, [isTabActive, updateTabPath, dashboardId]);

  const {
    userId,
    settings: { updateSchedule },
  } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [initialEditBlockIndex, setInitialEditBlockIndex] = useState<
    number | null
  >(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const { apiCall } = useAuth();
  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  const [temporaryDashboard, setTemporaryDashboard] = useState<
    DashboardInterface | undefined
  >(undefined);
  const [dashboardFirstSave, setDashboardFirstSave] = useState(false);
  const dashboard =
    dashboardId === "new"
      ? temporaryDashboard
      : dashboards.find((d) => d.id === dashboardId);

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const canCreate =
    permissionsUtil.canCreateReport(experiment) &&
    hasCommercialFeature("dashboards");
  let canEdit =
    permissionsUtil.canViewReportModal(experiment.project) &&
    hasCommercialFeature("dashboards");
  const canUpdateExperiment = permissionsUtil.canViewExperimentModal(
    experiment.project,
  );
  const isOwner = userId === dashboard?.userId;
  const isAdmin = permissionsUtil.canManageOrgSettings();
  const canDelete =
    permissionsUtil.canDeleteGeneralDashboards({
      projects: experiment.project ? [experiment.project] : [],
    }) &&
    (isOwner || isAdmin);
  if (dashboard?.editLevel === "private" && !isOwner && !isAdmin) {
    canEdit = false;
  }

  useEffect(() => {
    if (dashboard) {
      setBlocks(dashboard.blocks);
    } else {
      setBlocks([]);
    }
  }, [dashboard]);

  const submitDashboard: SubmitDashboard<
    CreateDashboardArgs | UpdateDashboardArgs
  > = useCallback(
    async ({ method: requestedMethod, dashboardId, data }) => {
      const method = dashboardId === "new" ? "POST" : requestedMethod;
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInterface;
      }>(`/dashboards/${method === "PUT" ? dashboardId : ""}`, {
        method: method,
        body: JSON.stringify(
          method === "PUT"
            ? {
                blocks: data.blocks,
                title: data.title,
                editLevel: data.editLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                shareLevel: data.shareLevel,
                userId: data.userId,
              }
            : {
                blocks: data.blocks ?? [],
                title: data.title,
                editLevel: data.editLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                shareLevel: data.shareLevel,
                experimentId: experiment.id,
              },
        ),
      });
      if (res.status === 200) {
        mutateDashboards();
        setBlocks(res.dashboard.blocks);
        if (dashboardId === "new") {
          setTemporaryDashboard(res.dashboard);
        }
        if (method === "POST" && dashboardId !== "new") {
          setDashboardId(res.dashboard.id);
        }
      } else {
        console.error(res);
      }
    },
    [apiCall, experiment.id, mutateDashboards],
  );

  const memoizedSetBlock = useCallback(
    (i: number, block: (typeof blocks)[number]) => {
      const newBlocks = [...blocks.slice(0, i), block, ...blocks.slice(i + 1)];
      setBlocks(newBlocks);
      submitDashboard({
        method: "PUT",
        dashboardId,
        data: {
          blocks: newBlocks,
        },
      });
    },
    [blocks, submitDashboard, dashboardId],
  );

  const toggleAutoUpdates = useCallback(async () => {
    if (!dashboard) return;
    await submitDashboard({
      method: "PUT",
      dashboardId,
      data: {
        enableAutoUpdates: !dashboard.enableAutoUpdates,
      },
    });
  }, [dashboard, dashboardId, submitDashboard]);

  const createOrPromptUpgrade = () => {
    if (canCreate) {
      setTemporaryDashboard(
        createTemporaryDashboard(userId, undefined, experiment.id),
      );
      setDashboardId("new");
      setDashboardFirstSave(true);
      setIsEditing(true);
    } else if (!hasCommercialFeature("dashboards")) {
      setShowUpgradeModal(true);
    }
  };

  const enterEditModeForBlock = useCallback(
    (blockIndex: number) => {
      setInitialEditBlockIndex(blockIndex);
      setIsEditing(true);
    },
    [setIsEditing],
  );

  if (loadingDashboards || !dashboardMounted) return <LoadingSpinner />;
  return (
    <DashboardSnapshotProvider
      experiment={experiment}
      dashboard={dashboard}
      mutateDefinitions={mutateDashboards}
    >
      {canEdit && isEditing && dashboard ? (
        <DashboardWorkspace
          experiment={experiment}
          dashboard={dashboard}
          submitDashboard={submitDashboard}
          mutate={mutateDashboards}
          close={() => {
            setIsEditing(false);
            setDashboardFirstSave(false);
            if (dashboardId === "new") {
              setDashboardId(dashboard.id === "new" ? "" : dashboard.id);
            }
          }}
          isTabActive={isTabActive}
          dashboardFirstSave={dashboardFirstSave}
          initialEditBlockIndex={initialEditBlockIndex}
          onConsumeInitialEditBlockIndex={() => setInitialEditBlockIndex(null)}
        />
      ) : (
        <div>
          {showUpgradeModal && (
            <UpgradeModal
              close={() => setShowUpgradeModal(false)}
              source="experiment-dashboards-tab"
              commercialFeature="dashboards"
            />
          )}
          {showCreateModal && (
            <DashboardModal
              mode="create"
              close={() => setShowCreateModal(false)}
              submit={async (data) => {
                await submitDashboard({ method: "POST", data });
                setIsEditing(true);
              }}
            />
          )}
          {dashboard && showEditModal && (
            <DashboardModal
              mode="edit"
              close={() => setShowEditModal(false)}
              initial={{
                editLevel: dashboard.editLevel,
                shareLevel: dashboard.shareLevel || "published",
                enableAutoUpdates: dashboard.enableAutoUpdates,
                updateSchedule: dashboard.updateSchedule || undefined,
                title: dashboard.title,
                projects: dashboard.projects || [],
                userId: dashboard.userId,
              }}
              submit={async (data) => {
                await submitDashboard({
                  method: "PUT",
                  dashboardId: dashboard.id,
                  data,
                });
              }}
            />
          )}
          {dashboard && showDuplicateModal && (
            <DashboardModal
              mode="duplicate"
              close={() => setShowDuplicateModal(false)}
              initial={{
                editLevel: dashboard.editLevel,
                shareLevel: dashboard.shareLevel || "published",
                enableAutoUpdates: dashboard.enableAutoUpdates,
                updateSchedule: dashboard.updateSchedule || undefined,
                title: `Copy of ${dashboard.title}`,
                projects: dashboard.projects || [],
                userId: dashboard.userId,
              }}
              submit={async (data) => {
                await submitDashboard({
                  method: "POST",
                  data: {
                    ...data,
                    blocks: blocks.map(getBlockData),
                  },
                });
                setIsEditing(true);
              }}
            />
          )}
          <div className="position-relative">
            {dashboards.length === 0 ? (
              <Flex
                direction="column"
                align="center"
                justify="center"
                px="80px"
                pt="60px"
                pb="70px"
                className="appbox"
                gap="5"
              >
                <Flex direction="column">
                  <Heading weight="medium" align="center">
                    Build a Custom Dashboard
                  </Heading>
                  <Text align="center">
                    Create a tailored view of your experiment. Highlight key
                    insights, add context, and share a clear story with your
                    team.
                  </Text>
                </Flex>
                <Flex align="center" justify="center">
                  <Button
                    size="sm"
                    onClick={createOrPromptUpgrade}
                    disabled={!canCreate}
                  >
                    Create Dashboard{" "}
                    <PaidFeatureBadge commercialFeature="dashboards" />
                  </Button>
                </Flex>
              </Flex>
            ) : (
              <>
                <Flex align="center" justify="between" mb="1">
                  <Flex gap="1" align="center">
                    {dashboards.length > 0 && !showDashboardView ? (
                      <Flex gap="4" align="center">
                        <DashboardSelector
                          dashboards={dashboards}
                          defaultDashboard={defaultDashboard}
                          value={dashboardId}
                          setValue={setDashboardId}
                          canCreate={canCreate}
                          onCreateNew={createOrPromptUpgrade}
                        />
                        <PaidFeatureBadge commercialFeature="dashboards" />
                      </Flex>
                    ) : (
                      <></>
                    )}
                  </Flex>
                  {dashboard && !showDashboardView ? (
                    <Flex gap="4" align="center">
                      <Tooltip
                        state={copySuccess}
                        ignoreMouseEvents
                        delay={0}
                        tipPosition="left"
                        body="URL copied to clipboard"
                        innerClassName="px-2 py-1"
                      >
                        <DashboardsTabMoreMenu
                          dashboard={dashboard}
                          experiment={experiment}
                          dashboardId={dashboardId}
                          canEdit={canEdit}
                          canUpdateExperiment={canUpdateExperiment}
                          canCreate={canCreate}
                          canDelete={canDelete}
                          updateSchedule={updateSchedule}
                          copySupported={copySupported}
                          mutateExperiment={mutateExperiment}
                          setIsEditing={setIsEditing}
                          setShowEditModal={setShowEditModal}
                          setShowDuplicateModal={setShowDuplicateModal}
                          toggleAutoUpdates={toggleAutoUpdates}
                          performCopy={performCopy}
                          mutateDashboards={mutateDashboards}
                          setDashboardId={setDashboardId}
                        />
                      </Tooltip>
                    </Flex>
                  ) : null}
                </Flex>
                {dashboard ? (
                  <>
                    {dashboard.blocks.length === 0 ? (
                      <Flex
                        direction="column"
                        align="center"
                        justify="center"
                        px="80px"
                        pt="60px"
                        pb="70px"
                        className="appbox"
                        gap="5"
                      >
                        {canEdit ? (
                          <>
                            <Flex direction="column">
                              <Heading weight="medium" align="center">
                                Build a Custom Dashboard
                              </Heading>
                              <Text align="center">
                                Choose a block type to get started. Rearrange
                                blocks to tell a story with experiment data.
                              </Text>
                            </Flex>
                            <Button
                              onClick={() => {
                                setIsEditing(true);
                              }}
                            >
                              Edit
                            </Button>
                          </>
                        ) : (
                          // TODO: empty state without permissions
                          <Heading weight="medium" align="center">
                            This Dashboard is empty
                          </Heading>
                        )}
                      </Flex>
                    ) : (
                      <DashboardEditor
                        isTabActive={isTabActive}
                        id={dashboard.id}
                        title={dashboard.title}
                        initialEditLevel={dashboard.editLevel}
                        ownerId={dashboard.userId}
                        initialShareLevel={dashboard.shareLevel}
                        dashboardOwnerId={dashboard.userId}
                        blocks={blocks}
                        projects={
                          experiment.project ? [experiment.project] : []
                        }
                        isEditing={false}
                        updateSchedule={dashboard.updateSchedule}
                        enableAutoUpdates={dashboard.enableAutoUpdates}
                        nextUpdate={experiment.nextSnapshotAttempt}
                        isGeneralDashboard={false}
                        enterEditModeForBlock={enterEditModeForBlock}
                        setBlock={canEdit ? memoizedSetBlock : undefined}
                        mutate={mutateDashboards}
                        switchToExperimentView={switchToExperimentView}
                        setIsEditing={setIsEditing}
                      />
                    )}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </DashboardSnapshotProvider>
  );
}

export default withErrorBoundary(DashboardsTab, {
  fallback: <Callout status="error">Failed to load dashboards</Callout>,
});
