import React, { useState } from "react";
import { useRouter } from "next/router";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import { useAuth } from "@/services/auth";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import PageHead from "@/components/Layout/PageHead";
import { useUser } from "@/services/UserContext";

export default function SingleDashboardPage() {
  const router = useRouter();
  const { did } = router.query;
  const { data, isLoading, error, mutate } = useApi<{
    dashboard: DashboardInterface;
  }>(`/dashboards/${did}`);
  const dashboard = data?.dashboard;
  const [isEditing, setIsEditing] = useState(false);
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();

  const submitDashboard = async ({
    method,
    dashboardId,
    data,
  }: {
    method: "PUT" | "POST";
    dashboardId?: string;
    data: {
      title?: DashboardInterface["title"];
      editLevel?: DashboardInterface["editLevel"];
      enableAutoUpdates?: DashboardInterface["enableAutoUpdates"];
      blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
    };
  }) => {
    const res = (await apiCall(
      `/dashboards/${method === "PUT" ? dashboardId : ""}`,
      {
        method,
        body: JSON.stringify(
          method === "PUT"
            ? {
                blocks: data.blocks,
                title: data.title,
                editLevel: data.editLevel,
                enableAutoUpdates: data.enableAutoUpdates,
              }
            : data,
        ),
      },
    )) as { status: number; dashboard: DashboardInterface };
    if (res.status === 200) {
      await mutate();
    }
  };

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (!dashboard) {
    router.replace("/404");
    return null;
  }

  if (isEditing && dashboard) {
    return (
      <DashboardWorkspace
        experiment={null}
        dashboard={dashboard}
        submitDashboard={({ method, dashboardId, data }) =>
          submitDashboard({ method, dashboardId, data })
        }
        mutate={mutate}
        close={() => setIsEditing(false)}
        isTabActive={true}
      />
    );
  }

  return (
    <div className="p-3 container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Dashboards", href: "/dashboards" },
          { display: dashboard.title },
        ]}
      />
      <DashboardSnapshotProvider
        dashboard={dashboard}
        mutateDefinitions={mutate}
      >
        <DashboardEditor
          isTabActive
          isGeneralDashboard={true}
          isEditing={false}
          title={dashboard.title}
          blocks={dashboard.blocks}
          enableAutoUpdates={dashboard.enableAutoUpdates}
          editSidebarDirty={false}
          focusedBlockIndex={undefined}
          stagedBlockIndex={undefined}
          scrollAreaRef={null}
          setBlock={() => {}}
          moveBlock={() => {}}
          addBlockType={() => {}}
          editBlock={() => {}}
          duplicateBlock={() => {}}
          deleteBlock={() => {}}
          mutate={mutate}
          nextUpdate={undefined}
          setIsEditing={setIsEditing}
          canShare={hasCommercialFeature("dashboards")}
        />
      </DashboardSnapshotProvider>
    </div>
  );
}
