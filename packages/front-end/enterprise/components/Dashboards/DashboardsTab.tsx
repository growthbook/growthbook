import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Container, Flex, Heading, Text } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { dashboardCanAutoUpdate, getBlockData } from "shared/enterprise";
import Button from "@/components/Radix/Button";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import EditButton from "@/components/EditButton/EditButton";
import { Select, SelectItem, SelectSeparator } from "@/components/Radix/Select";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { DropdownMenuSeparator } from "@/components/Radix/DropdownMenu";
import { useDashboards } from "@/hooks/useDashboards";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import LoadingSpinner from "@/components/LoadingSpinner";
import DashboardEditor from "./DashboardEditor";
import DashboardSnapshotProvider from "./DashboardSnapshotProvider";
import DashboardModal from "./DashboardModal";
import DashboardWorkspace from "./DashboardWorkspace";
import DashboardViewQueriesButton from "./DashboardEditor/DashboardViewQueriesButton";

export type CreateDashboardArgs = {
  method: "POST";
  dashboardId?: never;
  data: {
    title: string;
    editLevel: DashboardInterface["editLevel"];
    enableAutoUpdates: boolean;
    blocks?: DashboardBlockData<DashboardBlockInterface>[];
  };
};
export type UpdateDashboardArgs = {
  method: "PUT";
  dashboardId: string;
  data: Partial<{
    title: string;
    blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
    editLevel: DashboardInterface["editLevel"];
    enableAutoUpdates: boolean;
  }>;
};
export type SubmitDashboard<
  T extends CreateDashboardArgs | UpdateDashboardArgs,
> = (args: T) => Promise<void>;

export const autoUpdateDisabledMessage =
  "Automatic updates are disabled for dashboards with Dimension Analyses or SQL Explorer blocks, or when experiment updates are disabled";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  initialDashboardId: string;
  isTabActive: boolean;
}

export default function DashboardsTab({
  experiment,
  initialDashboardId,
  isTabActive,
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
  } = useDashboards(experiment.id);
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

  const {
    userId,
    settings: { updateSchedule },
  } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const { apiCall } = useAuth();
  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  const dashboard = dashboards.find((d) => d.id === dashboardId);

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const hasDashboardFeature = hasCommercialFeature("dashboards");
  const canCreate = permissionsUtil.canCreateReport(experiment);
  const canUpdateDashboard = experiment
    ? permissionsUtil.canViewReportModal(experiment.project)
    : true;
  const isOwner = userId === dashboard?.userId || !dashboard?.userId;
  const isAdmin = permissionsUtil.canSuperDeleteReport();
  const canEdit =
    isOwner ||
    isAdmin ||
    (dashboard.editLevel === "organization" && canUpdateDashboard);
  const canManage = isOwner || isAdmin;

  useEffect(() => {
    if (dashboard) {
      setBlocks(dashboard.blocks);
    } else {
      setBlocks([]);
    }
  }, [dashboard]);

  const submitDashboard = useCallback<
    SubmitDashboard<CreateDashboardArgs | UpdateDashboardArgs>
  >(
    async ({ method, dashboardId, data }) => {
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
              }
            : {
                blocks: data.blocks ?? [],
                title: data.title,
                editLevel: data.editLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                experimentId: experiment.id,
              },
        ),
      });
      if (res.status === 200) {
        mutateDashboards();
        setDashboardId(res.dashboard.id);
        setBlocks(res.dashboard.blocks);
      } else {
        console.error(res);
      }
    },
    [apiCall, experiment.id, mutateDashboards],
  );

  const autoUpdateDisabled = useMemo(
    () =>
      dashboard &&
      (!experiment.autoSnapshots ||
        !dashboardCanAutoUpdate(dashboard) ||
        updateSchedule?.type === "never"),
    [experiment, updateSchedule, dashboard],
  );

  if (loadingDashboards || !dashboardMounted) return <LoadingSpinner />;
  return (
    <DashboardSnapshotProvider
      experiment={experiment}
      dashboard={dashboard}
      mutateDefinitions={mutateDashboards}
    >
      {isEditing && dashboard ? (
        <DashboardWorkspace
          experiment={experiment}
          dashboard={dashboard}
          submitDashboard={submitDashboard}
          mutate={mutateDashboards}
          close={() => setIsEditing(false)}
          isTabActive={isTabActive}
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
          {dashboard && showDuplicateModal && (
            <DashboardModal
              mode="duplicate"
              close={() => setShowDuplicateModal(false)}
              initial={{
                editLevel: dashboard.editLevel,
                enableAutoUpdates: dashboard.enableAutoUpdates,
                title: `Copy of ${dashboard.title}`,
              }}
              disableAutoUpdate={autoUpdateDisabled}
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
                    Build a shareable story block-by-block using experiment
                    data.
                  </Text>
                </Flex>
                <Flex align="center" justify="center">
                  <Button size="sm" onClick={() => setShowCreateModal(true)}>
                    Create Dashboard
                  </Button>
                </Flex>
              </Flex>
            ) : (
              <>
                <Flex align="center" justify="between" mb="1">
                  <Flex gap="1" align="center">
                    {dashboards.length > 0 ? (
                      <Flex gap="4" align="center">
                        <Select
                          style={{
                            marginLeft: "var(--space-3)",
                            minWidth: "200px",
                          }}
                          value={dashboardId}
                          setValue={setDashboardId}
                        >
                          {defaultDashboard && (
                            <>
                              <SelectItem value={defaultDashboard.id}>
                                {defaultDashboard.title}
                              </SelectItem>
                              <SelectSeparator />
                            </>
                          )}
                          {dashboards.map((dash, i) => (
                            <Fragment key={`dash-${i}`}>
                              {dash.id === defaultDashboard?.id ? null : (
                                <SelectItem key={dash.id} value={dash.id}>
                                  {dash.title}
                                </SelectItem>
                              )}
                            </Fragment>
                          ))}
                          {dashboards.length > 0 && <SelectSeparator />}
                          <Button
                            onClick={() => {
                              hasDashboardFeature
                                ? setShowCreateModal(true)
                                : setShowUpgradeModal(true);
                            }}
                            variant="ghost"
                            className="rt-SelectItem"
                            icon={<PiPlus className="rt-SelectItemIndicator" />}
                            iconPosition="left"
                          >
                            <Text weight="regular">Create new dashboard</Text>
                          </Button>
                        </Select>
                        <PaidFeatureBadge commercialFeature="dashboards" />
                      </Flex>
                    ) : (
                      <></>
                    )}
                  </Flex>
                  {dashboard ? (
                    <Flex gap="4" align="center">
                      <Tooltip
                        state={copySuccess}
                        ignoreMouseEvents
                        delay={0}
                        tipPosition="left"
                        body="URL copied to clipboard"
                        innerClassName="px-2 py-1"
                      >
                        <MoreMenu>
                          {canEdit && hasDashboardFeature && (
                            <>
                              <EditButton
                                useIcon={false}
                                className="dropdown-item"
                                onClick={() => {
                                  setIsEditing(true);
                                }}
                              />
                              <Container px="5">
                                <DropdownMenuSeparator />
                              </Container>
                            </>
                          )}
                          {canManage && hasDashboardFeature && (
                            <Tooltip
                              body={autoUpdateDisabledMessage}
                              shouldDisplay={autoUpdateDisabled}
                            >
                              <Button
                                className="dropdown-item"
                                disabled={autoUpdateDisabled}
                                onClick={() =>
                                  submitDashboard({
                                    method: "PUT",
                                    dashboardId,
                                    data: {
                                      enableAutoUpdates:
                                        !dashboard.enableAutoUpdates,
                                    },
                                  })
                                }
                              >
                                <Text weight="regular">{`${
                                  dashboard.enableAutoUpdates &&
                                  !autoUpdateDisabled
                                    ? "Disable"
                                    : "Enable"
                                } Auto-update`}</Text>
                              </Button>
                            </Tooltip>
                          )}
                          <DashboardViewQueriesButton
                            className="dropdown-item text-capitalize"
                            weight="regular"
                            size="2"
                          />
                          <Container px="5">
                            <DropdownMenuSeparator />
                          </Container>
                          {copySupported && (
                            <Button
                              className="dropdown-item"
                              onClick={() => {
                                const url = window.location.href.replace(
                                  /[?#].*/,
                                  `#dashboards/${dashboardId}`,
                                );
                                performCopy(url);
                              }}
                            >
                              <Text weight="regular">Share</Text>
                            </Button>
                          )}
                          {canCreate && (
                            <Button
                              className="dropdown-item"
                              onClick={() =>
                                hasDashboardFeature
                                  ? setShowDuplicateModal(true)
                                  : setShowUpgradeModal(true)
                              }
                            >
                              <Flex align="center" gap="2">
                                <Text weight="regular">Duplicate</Text>
                                <PaidFeatureBadge commercialFeature="dashboards" />
                              </Flex>
                            </Button>
                          )}
                          {canManage && hasDashboardFeature && (
                            <>
                              <DeleteButton
                                displayName="Dashboard"
                                className="dropdown-item text-danger"
                                useIcon={false}
                                text="Delete"
                                title="Delete Dashboard"
                                onClick={async () => {
                                  await apiCall(`/dashboards/${dashboard.id}`, {
                                    method: "DELETE",
                                  });
                                  mutateDashboards();
                                  setDashboardId("");
                                }}
                              />
                            </>
                          )}
                        </MoreMenu>
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
                        experiment={experiment}
                        title={dashboard.title}
                        blocks={blocks}
                        isEditing={false}
                        enableAutoUpdates={dashboard.enableAutoUpdates}
                        setBlock={(i, block) => {
                          const newBlocks = [
                            ...blocks.slice(0, i),
                            block,
                            ...blocks.slice(i + 1),
                          ];
                          setBlocks(newBlocks);
                          submitDashboard({
                            method: "PUT",
                            dashboardId,
                            data: {
                              blocks: newBlocks,
                            },
                          });
                        }}
                        // TODO: reduce unnecessary props
                        stagedBlockIndex={undefined}
                        editSidebarDirty={false}
                        moveBlock={(_i, _direction) => {}}
                        addBlockType={() => {}}
                        editBlock={() => {}}
                        duplicateBlock={() => {}}
                        deleteBlock={() => {}}
                        focusedBlockIndex={undefined}
                        mutate={mutateDashboards}
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
