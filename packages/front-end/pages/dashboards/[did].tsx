import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { withErrorBoundary } from "@sentry/nextjs";
import { Flex, Text } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import { useAuth } from "@/services/auth";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import PageHead from "@/components/Layout/PageHead";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumCallout from "@/ui/PremiumCallout";
import Button from "@/ui/Button";

function SingleDashboardPage() {
  const router = useRouter();
  const { did } = router.query;
  const { data, isLoading, error, mutate } = useApi<{
    dashboard: DashboardInterface;
  }>(`/dashboards/${did}`);
  const dashboard = data?.dashboard;
  const [isEditing, setIsEditing] = useState(false);
  const { hasCommercialFeature, userId } = useUser();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const canUpdateDashboards = permissionsUtil.canCreateAnalyses(
    dashboard?.projects,
  );
  const isOwner = userId === dashboard?.userId || !dashboard?.userId;
  const isAdmin = permissionsUtil.canSuperDeleteReport();
  const canManage = isOwner || isAdmin;
  const canEdit =
    canManage || (dashboard.editLevel === "published" && canUpdateDashboards);

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

  const submitDashboard = useCallback(
    async ({
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
    },
    [apiCall, mutate],
  );

  const memoizedSetBlock = useCallback(
    (i: number, block: (typeof blocks)[number]) => {
      if (!dashboard) return;
      const newBlocks = [...blocks.slice(0, i), block, ...blocks.slice(i + 1)];
      setBlocks(newBlocks);
      submitDashboard({
        method: "PUT",
        dashboardId: dashboard.id,
        data: {
          blocks: newBlocks,
        },
      });
    },
    [blocks, submitDashboard, dashboard],
  );

  if (!hasCommercialFeature("product-analytics-dashboards")) {
    return (
      <PremiumCallout
        id="product-analytics-single-dashboard"
        dismissable={false}
        commercialFeature="product-analytics-dashboards"
      >
        <Flex direction="column">
          <Text>Use of Product Analytics Dashboards requires a paid plan</Text>
          <Button
            onClick={() => {
              setShowUpgradeModal(true);
            }}
          >
            Upgrade Plan
          </Button>
        </Flex>
      </PremiumCallout>
    );
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
          { display: "Product Analytics", href: "/dashboards" },
          { display: dashboard.title },
        ]}
      />
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="product-analytics-single-dashboard"
          commercialFeature="product-analytics-dashboards"
        />
      )}
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
            initialEditLevel={dashboard.editLevel}
            initialShareLevel={dashboard.shareLevel}
            dashboardOwnerId={dashboard.userId}
            isGeneralDashboard={true}
            isEditing={false}
            title={dashboard.title}
            blocks={dashboard.blocks}
            enableAutoUpdates={dashboard.enableAutoUpdates}
            setBlock={canEdit ? memoizedSetBlock : undefined}
            projects={dashboard.projects ? dashboard.projects : []}
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
