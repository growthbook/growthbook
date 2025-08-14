import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { Fragment, useCallback, useEffect, useState } from "react";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Container, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { PiPencilSimpleFill, PiPlus } from "react-icons/pi";
import clsx from "clsx";
import { cloneDeep, pick } from "lodash";
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
import DashboardEditor from "./DashboardEditor";
import DashboardSnapshotProvider from "./DashboardSnapshotProvider";
import DashboardModal from "./DashboardModal";

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
  T extends CreateDashboardArgs | UpdateDashboardArgs
> = (args: T) => Promise<void>;

export const autoUpdateDisabledMessage =
  "Automatic updates are disabled for dashboards with Dimension Analyses or SQL Explorer blocks, or when experiment updates are disabled";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  initialDashboardId: string;
}

export default function DashboardsTab({
  experiment,
  initialDashboardId,
}: Props) {
  const [dashboardId, setDashboardId] = useState(initialDashboardId);
  const [dashboardCopy, setDashboardCopy] = useState<
    DashboardInterface | undefined
  >(undefined);
  const [hasMadeChanges, setHasMadeChanges] = useState(false);
  useEffect(() => {
    if (initialDashboardId) {
      setDashboardId(initialDashboardId);
    }
  }, [initialDashboardId]);
  const { dashboards, mutateDashboards } = useDashboards(experiment.id);
  const defaultDashboard = dashboards.find((dash) => dash.isDefault);

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
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const { apiCall } = useAuth();
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  const [editLevel, setEditLevel] = useState<DashboardInterface["editLevel"]>(
    "private"
  );
  const [enableAutoUpdates, setEnableAutoUpdates] = useState(true);
  const [editDrawerOpen, setEditDrawerOpen] = useState<boolean>(false);
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  useEffect(() => {
    if (!isEditing) setHasMadeChanges(false);
  }, [isEditing]);

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
      setTitle(dashboard.title);
      setBlocks(dashboard.blocks);
      setEditLevel(dashboard.editLevel);
      setEnableAutoUpdates(dashboard.enableAutoUpdates);
    }
  }, [dashboard]);

  const submitDashboard = useCallback<
    SubmitDashboard<CreateDashboardArgs | UpdateDashboardArgs>
  >(
    async ({ method, dashboardId, data }) => {
      if (method === "PUT") setHasMadeChanges(true);
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
              }
        ),
      });
      if (res.status === 200) {
        mutateDashboards();
        setDashboardId(res.dashboard.id);
        setBlocks(res.dashboard.blocks);
        setTitle(res.dashboard.title);
        setEditLevel(res.dashboard.editLevel);
      } else {
        console.error(res);
      }
    },
    [apiCall, experiment.id, mutateDashboards]
  );

  const autoUpdateDisabled =
    !experiment.autoSnapshots ||
    !dashboardCanAutoUpdate({ blocks }) ||
    updateSchedule?.type === "never";

  return (
    <DashboardSnapshotProvider
      experiment={experiment}
      dashboard={dashboard}
      mutateDefinitions={mutateDashboards}
    >
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
        {showUpdateModal && (
          <DashboardModal
            mode="edit"
            close={() => setShowUpdateModal(false)}
            initial={{ editLevel, title, enableAutoUpdates }}
            disableAutoUpdate={autoUpdateDisabled}
            submit={async (data) => {
              await submitDashboard({ method: "PUT", dashboardId, data });
            }}
          />
        )}
        {showDuplicateModal && (
          <DashboardModal
            mode="duplicate"
            close={() => setShowDuplicateModal(false)}
            initial={{
              editLevel,
              enableAutoUpdates,
              title: `Copy of ${title}`,
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
              <Heading weight="medium" align="center">
                Build a Custom Dashboard
              </Heading>
              <Text align="center">
                Customize your reporting to tell a story with experiment data.
              </Text>
              <Flex align="center" justify="center">
                <Button
                  size="md"
                  icon={<PiPlus />}
                  iconPosition="right"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create Dashboard
                </Button>
              </Flex>
            </Flex>
          ) : (
            <>
              <Flex align="center" justify="between" mb="1">
                <Flex gap="1" align="center">
                  {isEditing ? (
                    <>
                      {canManage ? (
                        <div className="position-relative">
                          <Flex
                            gap="8"
                            align="center"
                            className={clsx("cursor-pointer", {
                              "dashboard-disabled": editDrawerOpen,
                            })}
                            onClick={() => setShowUpdateModal(true)}
                          >
                            <Text size="5" weight="medium">
                              {title}
                            </Text>
                            <IconButton size="1" variant="ghost">
                              <PiPencilSimpleFill />
                            </IconButton>
                          </Flex>
                          <div
                            className="position-absolute"
                            style={{
                              width: "100%",
                              height: 1,
                              backgroundColor: "var(--slate-5)",
                            }}
                          />
                        </div>
                      ) : (
                        <Text size="5" weight="medium">
                          {title}
                        </Text>
                      )}
                    </>
                  ) : dashboards.length > 0 ? (
                    <Flex gap="4" align="center">
                      <Select
                        style={{
                          marginLeft: "var(--space-3)",
                          minWidth: "200px",
                          borderBottom: "1px solid var(--slate-a5)",
                        }}
                        variant="ghost"
                        value={dashboardId}
                        setValue={setDashboardId}
                        triggerClassName={
                          dashboards.length === 1 ? "disable-dropdown" : ""
                        }
                      >
                        {defaultDashboard && (
                          <>
                            <SelectItem value={defaultDashboard.id}>
                              {defaultDashboard.title}
                            </SelectItem>
                            {dashboards.length > 1 && <SelectSeparator />}
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
                      </Select>
                      {canCreate && (
                        <Tooltip body="Create new dashboard" tipPosition="top">
                          <IconButton
                            onClick={() => {
                              hasDashboardFeature
                                ? setShowCreateModal(true)
                                : setShowUpgradeModal(true);
                            }}
                            variant="soft"
                            size="2"
                          >
                            <PiPlus />
                          </IconButton>
                        </Tooltip>
                      )}
                      <PaidFeatureBadge commercialFeature="dashboards" />
                    </Flex>
                  ) : (
                    <></>
                  )}
                </Flex>
                {dashboard && (
                  <>
                    {isEditing ? (
                      <Flex gap="1">
                        {dashboardCopy && hasMadeChanges && (
                          <Tooltip
                            body="Undo all changes made during this current edit session"
                            tipPosition="top"
                          >
                            <Button
                              className={clsx({
                                "dashboard-disabled": editDrawerOpen,
                              })}
                              onClick={async () => {
                                await submitDashboard({
                                  method: "PUT",
                                  dashboardId: dashboardId,
                                  data: pick(dashboardCopy, [
                                    "blocks",
                                    "title",
                                    "editLevel",
                                    "enableAutoUpdates",
                                  ]),
                                });
                                setIsEditing(false);
                              }}
                              variant="ghost"
                              color="red"
                            >
                              Undo Changes
                            </Button>
                          </Tooltip>
                        )}
                        <Button
                          className={clsx({
                            "dashboard-disabled": editDrawerOpen,
                          })}
                          onClick={async () => {
                            setIsEditing(false);
                            setDashboardCopy(undefined);
                          }}
                        >
                          Done Editing
                        </Button>
                      </Flex>
                    ) : (
                      <Flex gap="4" align="center">
                        {copySupported && (
                          <Tooltip
                            state={copySuccess}
                            ignoreMouseEvents
                            delay={0}
                            tipPosition="top"
                            body="URL copied to clipboard"
                            innerClassName="px-2 py-1"
                          >
                            <Button
                              variant="outline"
                              onClick={() => {
                                const url = window.location.href.replace(
                                  /[?#].*/,
                                  `#dashboards/${dashboardId}`
                                );
                                performCopy(url);
                              }}
                            >
                              Share
                            </Button>
                          </Tooltip>
                        )}
                        <MoreMenu>
                          {canCreate && (
                            <>
                              <Button
                                className="dropdown-item"
                                onClick={() => {
                                  hasDashboardFeature
                                    ? setShowCreateModal(true)
                                    : setShowUpgradeModal(true);
                                }}
                              >
                                <Flex align="center" gap="2">
                                  <Text weight="regular">
                                    Create New Dashboard
                                  </Text>
                                  <PaidFeatureBadge commercialFeature="dashboards" />
                                </Flex>
                              </Button>
                              <Container px="4">
                                <DropdownMenuSeparator />
                              </Container>
                            </>
                          )}
                          {canEdit && hasDashboardFeature && (
                            <EditButton
                              useIcon={false}
                              className="dropdown-item"
                              onClick={() => {
                                setDashboardCopy(cloneDeep(dashboard));
                                setIsEditing(true);
                              }}
                            />
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
                                      enableAutoUpdates: !enableAutoUpdates,
                                    },
                                  })
                                }
                              >
                                <Text weight="regular">{`${
                                  enableAutoUpdates && !autoUpdateDisabled
                                    ? "Disable"
                                    : "Enable"
                                } Auto-updates`}</Text>
                              </Button>
                            </Tooltip>
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
                              <Container px="4">
                                <DropdownMenuSeparator />
                              </Container>
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
                      </Flex>
                    )}
                  </>
                )}
              </Flex>
              {dashboard && (
                <DashboardEditor
                  experiment={experiment}
                  blocks={blocks}
                  canEdit={canEdit}
                  isEditing={isEditing}
                  editDrawerOpen={editDrawerOpen}
                  enableAutoUpdates={enableAutoUpdates}
                  forceToEditing={() => {
                    setDashboardCopy(cloneDeep(dashboard));
                    setIsEditing(true);
                  }}
                  setBlocks={(blocks) => {
                    setBlocks(blocks);
                    submitDashboard({
                      method: "PUT",
                      dashboardId,
                      data: {
                        blocks,
                      },
                    });
                  }}
                  setEditDrawerOpen={setEditDrawerOpen}
                  mutate={mutateDashboards}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DashboardSnapshotProvider>
  );
}
