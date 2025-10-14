import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { withErrorBoundary } from "@sentry/nextjs";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import { useAuth } from "@/services/auth";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import PageHead from "@/components/Layout/PageHead";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";

function SingleDashboardPage() {
  const router = useRouter();
  const { did } = router.query;
  const { data, isLoading, error, mutate } = useApi<{
    dashboard: DashboardInterface;
  }>(`/dashboards/${did}`);
  const dashboard = data?.dashboard;
  const [isEditing, setIsEditing] = useState(false);
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();
  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  useEffect(() => {
    if (dashboard) {
      setBlocks(dashboard.blocks);
    } else {
      setBlocks([]);
    }
  }, [dashboard]);

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

  if (!hasCommercialFeature("product-analytics-dashboards")) {
    return <>TODO: upgrade modal</>;
  }

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
        {isEditing && dashboard ? (
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
        ) : (
          <DashboardEditor
            isTabActive
            id={dashboard.id}
            editLevel={dashboard.editLevel}
            shareLevel={dashboard.shareLevel}
            dashboardOwnerId={dashboard.userId}
            isGeneralDashboard={true}
            isEditing={false}
            title={dashboard.title}
            blocks={dashboard.blocks}
            enableAutoUpdates={dashboard.enableAutoUpdates}
            editSidebarDirty={false}
            focusedBlockIndex={undefined}
            stagedBlockIndex={undefined}
            scrollAreaRef={null}
            setBlock={(i, block) => {
              const newBlocks = [
                ...blocks.slice(0, i),
                block,
                ...blocks.slice(i + 1),
              ];
              setBlocks(newBlocks);
              submitDashboard({
                method: "PUT",
                dashboardId: dashboard.id,
                data: {
                  blocks: newBlocks,
                },
              });
            }}
            projects={dashboard.projects ? dashboard.projects : []}
            moveBlock={() => {}}
            editBlock={() => {}}
            duplicateBlock={() => {}}
            deleteBlock={() => {}}
            mutate={mutate}
            nextUpdate={dashboard.nextUpdate}
            dashboardLastUpdated={dashboard.lastUpdated}
            setIsEditing={setIsEditing}
          />
        )}
      </DashboardSnapshotProvider>
    </div>
  );
}

export default withErrorBoundary(SingleDashboardPage, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
