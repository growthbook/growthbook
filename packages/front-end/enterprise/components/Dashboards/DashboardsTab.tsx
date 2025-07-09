import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import {
  DashboardBlockData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { PiPencil, PiPlus } from "react-icons/pi";
import clsx from "clsx";
import { cloneDeep, pick } from "lodash";
import { isDefined } from "shared/util";
import { dashboardCanAutoUpdate } from "shared/enterprise";
import Button from "@/components/Radix/Button";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import EditButton from "@/components/EditButton/EditButton";
import { Select, SelectItem } from "@/components/Radix/Select";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import DashboardEditor from "./DashboardEditor";
import DashboardSnapshotProvider from "./DashboardSnapshotProvider";
import CreateUpdateDashboardModal from "./CreateUpdateDashboardModal";

export type CreateDashboardArgs = {
  method: "POST";
  dashboardId?: never;
  data: {
    title: string;
    editLevel: DashboardInstanceInterface["editLevel"];
    enableAutoUpdates: boolean;
  };
};
export type UpdateDashboardArgs = {
  method: "PUT";
  dashboardId: string;
  data: Partial<{
    title: string;
    blocks: DashboardBlockData<DashboardBlockInterface>[];
    editLevel: DashboardInstanceInterface["editLevel"];
    enableAutoUpdates: boolean;
  }>;
};
export type SubmitDashboard<
  T extends CreateDashboardArgs | UpdateDashboardArgs
> = (args: T) => Promise<void>;

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
    DashboardInstanceInterface | undefined
  >(undefined);
  useEffect(() => {
    if (initialDashboardId) {
      setDashboardId(initialDashboardId);
    }
  }, [initialDashboardId]);
  const {
    dashboards: allDashboards,
    mutateDefinitions: mutateDashboardList,
  } = useDefinitions();
  const dashboards = useMemo(
    () => allDashboards.filter((d) => d.experimentId === experiment.id),
    [allDashboards, experiment.id]
  );
  const { userId } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const { apiCall } = useAuth();
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<
    DashboardBlockData<DashboardBlockInterface>[]
  >([]);
  const [editLevel, setEditLevel] = useState<
    DashboardInstanceInterface["editLevel"]
  >("private");
  const [enableAutoUpdates, setEnableAutoUpdates] = useState(true);
  const [editingBlock, setEditingBlock] = useState<number | undefined>(
    undefined
  );
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  const dashboard = dashboards.find((d) => d.id === dashboardId);

  useEffect(() => {
    if (!isEditing) setEditingBlock(undefined);
  }, [isEditing]);

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateReport(experiment);
  const canUpdateReport = experiment
    ? permissionsUtil.canViewReportModal(experiment.project)
    : false;
  const isOwner = userId === dashboard?.userId || !dashboard?.userId;
  const isAdmin = permissionsUtil.canSuperDeleteReport();
  const canEdit =
    isOwner ||
    isAdmin ||
    (dashboard.editLevel === "organization" && canUpdateReport);
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
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInstanceInterface;
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
                blocks: [],
                title: data.title,
                editLevel: data.editLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                experimentId: experiment.id,
              }
        ),
      });
      if (res.status === 200) {
        mutateDashboardList();
        setDashboardId(res.dashboard.id);
        setBlocks(res.dashboard.blocks);
        setTitle(res.dashboard.title);
        setEditLevel(res.dashboard.editLevel);
      } else {
        console.error(res);
      }
    },
    [apiCall, experiment.id, mutateDashboardList]
  );

  return (
    <DashboardSnapshotProvider
      experiment={experiment}
      dashboard={dashboard}
      mutateDefinitions={mutateDashboardList}
    >
      <div className="mt-3">
        {showCreateModal && (
          <CreateUpdateDashboardModal
            close={() => setShowCreateModal(false)}
            submit={async (data) => {
              await submitDashboard({ method: "POST", data });
              setIsEditing(true);
            }}
          />
        )}
        {showUpdateModal && (
          <CreateUpdateDashboardModal
            close={() => setShowUpdateModal(false)}
            initial={{ editLevel, title, enableAutoUpdates }}
            disableAutoUpdate={!dashboardCanAutoUpdate({ blocks })}
            submit={async (data) => {
              await submitDashboard({ method: "PUT", dashboardId, data });
            }}
          />
        )}
        <div className="mx-3 p-4 position-relative">
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
                    <div className="position-relative">
                      <Flex
                        gap="8"
                        align="center"
                        className={clsx("cursor-pointer", {
                          "dashboard-disabled": isDefined(editingBlock),
                        })}
                        onClick={() => setShowUpdateModal(true)}
                      >
                        <Text size="5" weight="medium">
                          {title}
                        </Text>
                        <IconButton size="1" variant="ghost">
                          <PiPencil />
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
                  ) : dashboards.length > 0 ? (
                    <>
                      <Select value={dashboardId} setValue={setDashboardId}>
                        {dashboards.map((dash) => (
                          <SelectItem key={dash.id} value={dash.id}>
                            {dash.title}
                          </SelectItem>
                        ))}
                      </Select>
                      {canCreate && (
                        <Tooltip body="Create new dashboard" tipPosition="top">
                          <IconButton
                            onClick={() => {
                              setShowCreateModal(true);
                            }}
                            variant="soft"
                            size="2"
                          >
                            <PiPlus />
                          </IconButton>
                        </Tooltip>
                      )}
                    </>
                  ) : (
                    <></>
                  )}
                </Flex>
                {dashboard && (
                  <>
                    {isEditing ? (
                      <Flex gap="1">
                        <Button
                          className={clsx({
                            "dashboard-disabled": editingBlock !== undefined,
                          })}
                          onClick={async () => {
                            if (!dashboardCopy) return;
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
                          Discard Changes
                        </Button>
                        <Button
                          className={clsx({
                            "dashboard-disabled": editingBlock !== undefined,
                          })}
                          onClick={async () => {
                            setIsEditing(false);
                            setDashboardCopy(undefined);
                          }}
                        >
                          Done
                        </Button>
                      </Flex>
                    ) : (
                      <Flex gap="1">
                        {copySupported && (
                          <Tooltip
                            state={copySuccess}
                            ignoreMouseEvents
                            delay={0}
                            tipPosition="top"
                            body="Copied to clipboard!"
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
                          {canEdit && (
                            <EditButton
                              useIcon={false}
                              className="dropdown-item"
                              onClick={() => {
                                setDashboardCopy(cloneDeep(dashboard));
                                setIsEditing(true);
                              }}
                            />
                          )}
                          {canCreate && (
                            <div className="dropdown-item">Duplicate</div>
                          )}
                          {canManage && (
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
                                mutateDashboardList();
                                setDashboardId("");
                              }}
                              canDelete={canManage}
                            />
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
                  editingBlock={editingBlock}
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
                  setEditingBlock={setEditingBlock}
                  mutate={mutateDashboardList}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DashboardSnapshotProvider>
  );
}
