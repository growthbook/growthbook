import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import {
  DashboardBlockData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { PiPencil, PiPlus } from "react-icons/pi";
import { useForm } from "react-hook-form";
import clsx from "clsx";
import { cloneDeep, debounce } from "lodash";
import Button from "@/components/Radix/Button";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import EditButton from "@/components/EditButton/EditButton";
import { Select, SelectItem } from "@/components/Radix/Select";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Checkbox from "@/components/Radix/Checkbox";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import LoadingSpinner from "@/components/LoadingSpinner";
import DashboardEditor from "./DashboardEditor";
import DashboardSnapshotProvider from "./DashboardSnapshotProvider";

type CreateDashboardArgs = {
  method: "POST";
  dashboardId?: never;
  data: {
    title: string;
    editLevel: DashboardInstanceInterface["editLevel"];
  };
};
type UpdateDashboardArgs = {
  method: "PUT";
  dashboardId: string;
  data: Partial<{
    title: string;
    blocks: DashboardBlockData<DashboardBlockInterface>[];
    editLevel: DashboardInstanceInterface["editLevel"];
  }>;
};
type SubmitDashboard<T extends CreateDashboardArgs | UpdateDashboardArgs> = (
  args: T
) => Promise<void>;

function CreateDashboardModal({
  close,
  submit,
}: {
  close: () => void;
  submit: SubmitDashboard<CreateDashboardArgs>;
}) {
  const form = useForm<{
    title: string;
    editLevel: "organization" | "private";
  }>({
    defaultValues: {
      title: "",
      editLevel: "private",
    },
  });
  return (
    <Modal
      open={true}
      trackingEventModalType="create-dashboard"
      header="Create New Dashboard"
      cta="Create"
      submit={() => submit({ method: "POST", data: form.getValues() })}
      ctaEnabled={!!form.watch("title")}
      close={close}
      closeCta="Cancel"
    >
      <Field
        label="Name"
        placeholder="Dashboard name"
        {...form.register("title")}
      />
      <Checkbox
        label="Allow editing by organization members"
        value={form.watch("editLevel") === "organization"}
        setValue={(checked) => {
          form.setValue("editLevel", checked ? "organization" : "private");
        }}
      />
    </Modal>
  );
}

interface Props {
  experiment: ExperimentInterfaceStringDates;
  initialDashboardId: string;
}

export default function DashboardsTab({
  experiment,
  initialDashboardId,
}: Props) {
  const [dashboardId, setDashboardId] = useState(initialDashboardId);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [dashboardCopy, setDashboardCopy] = useState<
    DashboardInstanceInterface | undefined
  >(undefined);
  useEffect(() => {
    setDashboardId(initialDashboardId);
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
  const { apiCall } = useAuth();
  const [title, setTitleRaw] = useState("");
  const [blocks, setBlocksRaw] = useState<
    DashboardBlockData<DashboardBlockInterface>[]
  >([]);
  const [editLevel, setEditLevelRaw] = useState<
    DashboardInstanceInterface["editLevel"]
  >("private");
  const [editingBlock, setEditingBlock] = useState<number | undefined>(
    undefined
  );
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });
  const setTitle = useMemo(
    () => (title: string) => {
      setTitleRaw(title);
      setIsDirty(true);
    },
    []
  );
  const setBlocks = useMemo(
    () => (blocks: DashboardBlockData<DashboardBlockInterface>[]) => {
      setBlocksRaw(blocks);
      setIsDirty(true);
    },
    []
  );
  const setEditLevel = useMemo(
    () => (editLevel: DashboardInstanceInterface["editLevel"]) => {
      setEditLevelRaw(editLevel);
      setIsDirty(true);
    },
    []
  );

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
  const canDelete = isOwner || isAdmin;

  useEffect(() => {
    if (!dashboardId && dashboards.length > 0) {
      setDashboardId(dashboards[0].id);
    }
  }, [dashboards, dashboardId]);

  useEffect(() => {
    if (dashboard) {
      setTitleRaw(dashboard.title);
      setBlocksRaw(dashboard.blocks);
      setEditLevelRaw(dashboard.editLevel);
    }
  }, [dashboard]);

  const submitDashboard = useCallback<
    SubmitDashboard<CreateDashboardArgs | UpdateDashboardArgs>
  >(
    async ({ method, dashboardId, data }) => {
      if (isSaving) return;
      setIsSaving(true);
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
              }
            : {
                blocks: [],
                title: data.title,
                editLevel: data.editLevel,
                experimentId: experiment.id,
              }
        ),
      });
      if (res.status === 200) {
        setIsDirty(false);
        mutateDashboardList();
        setDashboardId(res.dashboard.id);
        setBlocksRaw(res.dashboard.blocks);
        setTitleRaw(res.dashboard.title);
        setEditLevelRaw(res.dashboard.editLevel);
      } else {
        console.error(res);
      }
      setIsSaving(false);
    },
    [isSaving, apiCall, experiment.id, mutateDashboardList]
  );

  const debouncedSubmit = useMemo(
    () =>
      debounce(submitDashboard, 2000, {
        leading: false,
        trailing: true,
      }),
    [submitDashboard]
  );

  useEffect(() => {
    if (!isDirty) return;
    const submit = async () => {
      await debouncedSubmit({
        method: "PUT",
        dashboardId: dashboardId,
        data: {
          blocks: blocks,
          title: title,
          editLevel: editLevel,
        },
      });
    };
    submit();
  }, [isDirty, debouncedSubmit, dashboardId, blocks, title, editLevel]);

  return (
    <DashboardSnapshotProvider
      experiment={experiment}
      dashboard={dashboard}
      mutateDefinitions={mutateDashboardList}
    >
      <div className="mt-3">
        {showCreateModal && (
          <CreateDashboardModal
            close={() => setShowCreateModal(false)}
            submit={async ({ data }: CreateDashboardArgs) => {
              await submitDashboard({ method: "POST", data });
              setIsEditing(true);
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
                    <Field
                      disabled={editingBlock !== undefined}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      append={<PiPencil />}
                    />
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
                              data: dashboardCopy,
                            });
                            setIsEditing(false);
                          }}
                          variant="ghost"
                          color="red"
                        >
                          Discard Changes
                        </Button>
                        {isSaving ? (
                          <Flex gap="1" align="center">
                            <LoadingSpinner />
                            <Text>Saving...</Text>
                          </Flex>
                        ) : isDirty ? (
                          <Button
                            className={clsx({
                              "dashboard-disabled": editingBlock !== undefined,
                            })}
                            onClick={async () => {
                              await submitDashboard({
                                method: "PUT",
                                dashboardId: dashboardId,
                                data: { title, blocks, editLevel },
                              });
                              setIsEditing(false);
                              setDashboardCopy(undefined);
                            }}
                          >
                            Save
                          </Button>
                        ) : (
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
                        )}
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
                          {canDelete && (
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
                              canDelete={canDelete}
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
                  editLevel={editLevel}
                  setIsEditing={setIsEditing}
                  setBlocks={setBlocks}
                  setEditingBlock={setEditingBlock}
                  setEditLevel={setEditLevel}
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
