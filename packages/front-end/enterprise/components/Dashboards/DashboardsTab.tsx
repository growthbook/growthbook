import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import {
  DashboardBlockData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { PiPencil, PiPlus } from "react-icons/pi";
import { useForm } from "react-hook-form";
import clsx from "clsx";
import { isDefined } from "shared/util";
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
import { useScrollPosition } from "@/hooks/useScrollPosition";
import DashboardEditor from "./DashboardEditor";

export type SubmitDashboard = (
  data: Partial<{
    title: string;
    blocks: DashboardBlockData<DashboardBlockInterface>[];
  }>
) => Promise<void>;

function CreateDashboardModal({
  close,
  submit,
}: {
  close: () => void;
  submit: SubmitDashboard;
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
      submit={() => submit(form.getValues())}
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
  dashboardId: string;
  experimentHeaderRef: MutableRefObject<HTMLDivElement | null>;
  setDashboardId: React.Dispatch<string>;
}

export default function DashboardsTab({
  experiment,
  dashboardId,
  experimentHeaderRef,
  setDashboardId,
}: Props) {
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
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<
    DashboardBlockData<DashboardBlockInterface>[]
  >([]);
  const [editingBlock, setEditingBlock] = useState<number | undefined>(
    undefined
  );
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });
  const [stickyTop, setStickyTop] = useState<number | undefined>(undefined);
  const { scrollY } = useScrollPosition();
  const editBarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!experimentHeaderRef.current || !editBarRef.current) {
      setStickyTop(undefined);
      return;
    }
    const editTop = editBarRef.current.getBoundingClientRect().top;
    const headerBottom = experimentHeaderRef.current.getBoundingClientRect()
      .bottom;
    if (editTop <= headerBottom) {
      setStickyTop(headerBottom);
    } else {
      setStickyTop(undefined);
    }
  }, [experimentHeaderRef, scrollY]);

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
      console.log("Setting dashId to", dashboards[0].id);
      setDashboardId(dashboards[0].id);
    }
  }, [dashboards, dashboardId, setDashboardId]);

  useEffect(() => {
    if (dashboard) {
      setTitle(dashboard.title);
      setBlocks(dashboard.blocks);
    }
  }, [dashboard]);

  const submitDashboard = useCallback(
    async (
      method: "PUT" | "POST",
      dashboardData: Partial<{
        title: string;
        blocks: DashboardBlockData<DashboardBlockInterface>[];
      }>
    ) => {
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInstanceInterface;
      }>(`/dashboards/${method === "PUT" ? dashboardId : ""}`, {
        method: method,
        body: JSON.stringify(
          method === "PUT"
            ? dashboardData
            : { blocks: [], ...dashboardData, experimentId: experiment.id }
        ),
      });
      if (res.status === 200) {
        mutateDashboardList();
        setDashboardId(res.dashboard.id);
      } else {
        console.error(res);
      }
    },
    [apiCall, dashboardId, experiment.id, mutateDashboardList, setDashboardId]
  );

  return (
    <div className="mt-3">
      {showCreateModal && (
        <CreateDashboardModal
          close={() => setShowCreateModal(false)}
          submit={async (data) => {
            await submitDashboard("POST", data);
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
            <Flex
              ref={editBarRef}
              align="center"
              justify="between"
              mb="1"
              style={
                isEditing && stickyTop && !isDefined(editingBlock)
                  ? {
                      position: "sticky",
                      top: stickyTop,
                      zIndex: 900,
                      backgroundColor: "var(--color-background)",
                      boxShadow:
                        "0 1px 2px rgba(0, 0, 0, 0.1), 0 4px 4px rgba(0, 0, 0, 0.025)",
                    }
                  : {}
              }
            >
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
                        onClick={() => {
                          setTitle(dashboard.title);
                          setBlocks(dashboard.blocks);
                          setIsEditing(false);
                        }}
                        variant="ghost"
                      >
                        Cancel
                      </Button>
                      <Button
                        className={clsx({
                          "dashboard-disabled": editingBlock !== undefined,
                        })}
                        onClick={async () => {
                          await submitDashboard("PUT", { title, blocks });
                          setIsEditing(false);
                        }}
                      >
                        Save & Close
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
                setIsEditing={setIsEditing}
                setBlocks={setBlocks}
                setEditingBlock={setEditingBlock}
                mutate={mutateDashboardList}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
