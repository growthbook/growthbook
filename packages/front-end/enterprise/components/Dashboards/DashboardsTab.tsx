import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { getDefaultDashboardSettingsForExperiment } from "shared/enterprise";
import {
  DashboardBlockData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiPencil, PiPlus } from "react-icons/pi";
import { useForm } from "react-hook-form";
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
  const form = useForm<{ title: string }>();
  return (
    <Modal
      open={true}
      trackingEventModalType="create-dashboard"
      header="Create New Dashboard"
      cta="Create"
      submit={() => submit({ title: form.getValues("title") })}
      ctaEnabled={!!form.watch("title")}
      close={close}
      closeCta="Cancel"
    >
      <Field
        label="Name"
        placeholder="Dashboard name"
        {...form.register("title")}
      />
    </Modal>
  );
}

interface Props {
  experiment: ExperimentInterfaceStringDates;
}

export default function DashboardsTab({ experiment }: Props) {
  const {
    dashboards: allDashboards,
    mutateDefinitions: mutateDashboardList,
  } = useDefinitions();
  const dashboards = useMemo(
    () => allDashboards.filter((d) => d.experimentId === experiment.id),
    [allDashboards, experiment.id]
  );
  const [isEditing, setIsEditing] = useState(false);
  const [dashboard, setDashboard] = useState<
    DashboardInstanceInterface | undefined
  >(undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { apiCall } = useAuth();
  const [title, setTitle] = useState("");

  const permissionsUtil = usePermissionsUtil();
  const canDelete =
    permissionsUtil.canDeleteReport(experiment) ||
    permissionsUtil.canSuperDeleteReport();
  const canCreate = permissionsUtil.canCreateReport(experiment);

  useEffect(() => {
    if (!dashboard && dashboards.length > 0) setDashboard(dashboards[0]);
  }, [dashboards, dashboard]);
  const dashboardId = dashboard?.id || "";

  useEffect(() => {
    if (dashboard) setTitle(dashboard.title);
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
        setDashboard(res.dashboard);
        mutateDashboardList();
      } else {
        console.error(res);
      }
    },
    [apiCall, dashboardId, experiment.id, mutateDashboardList]
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
      <div className="mx-3 p-4">
        <Flex align="center" justify="between" mb="1">
          <Flex gap="1" align="center">
            {isEditing ? (
              <Field
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                append={<PiPencil />}
              />
            ) : (
              <Select
                value={dashboardId}
                setValue={(value) => {
                  setDashboard(dashboards.find((dash) => dash.id === value));
                }}
              >
                {dashboards.map((dash) => (
                  <SelectItem key={dash.id} value={dash.id}>
                    {dash.title}
                  </SelectItem>
                ))}
              </Select>
            )}

            {canCreate && !isEditing && (
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
          </Flex>
          {dashboard && (
            <>
              {isEditing ? (
                <Button
                  onClick={async () => {
                    await submitDashboard("PUT", { title });
                    setIsEditing(false);
                  }}
                >
                  Save & Close
                </Button>
              ) : (
                <MoreMenu>
                  <EditButton
                    useIcon={false}
                    className="dropdown-item"
                    onClick={() => {
                      setIsEditing(true);
                    }}
                  />
                  <div className="dropdown-item">Share</div>
                  <div className="dropdown-item">Duplicate</div>
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
                      setDashboard(undefined);
                    }}
                    canDelete={canDelete}
                  />
                </MoreMenu>
              )}
            </>
          )}
        </Flex>
        {dashboard && (
          <DashboardEditor
            submitCallback={(data) =>
              submitDashboard("PUT", { title, ...data })
            }
            experiment={experiment}
            dashboard={dashboard}
            defaultSettings={getDefaultDashboardSettingsForExperiment(
              experiment
            )}
            isEditing={isEditing}
            mutate={mutateDashboardList}
          />
        )}
      </div>
    </div>
  );
}
