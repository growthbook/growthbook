import React, { useState, useCallback } from "react";
import { useRouter } from "next/router";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
} from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardSeriesDisplayProvider from "@/enterprise/components/Dashboards/DashboardSeriesDisplayProvider";
import {
  SubmitDashboard,
  UpdateDashboardArgs,
} from "@/enterprise/components/Dashboards/DashboardsTab";
import PremiumCallout from "@/ui/PremiumCallout";
import { useDashboards } from "@/hooks/useDashboards";

export function createTemporaryDashboard(
  userId: string | undefined,
  project: string | undefined,
  experimentId?: string,
): DashboardInterface {
  const now = new Date();
  return {
    id: "new",
    uid: "new",
    organization: "", // Will be set by backend
    experimentId: experimentId,
    isDefault: false,
    isDeleted: false,
    userId: userId || "",
    editLevel: "private",
    shareLevel: experimentId ? "published" : "private",
    enableAutoUpdates: false,
    title: "Untitled Dashboard",
    blocks: [],
    projects: project ? [project] : [],
    dateCreated: now,
    dateUpdated: now,
  };
}

export default function NewDashboardPage() {
  const { project } = useDefinitions();
  const { userId, hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();
  const router = useRouter();
  const { mutateDashboards } = useDashboards(false);

  const [dashboard, setDashboard] = useState<DashboardInterface>(() =>
    createTemporaryDashboard(userId, project),
  );

  const handleSubmitDashboard: SubmitDashboard<UpdateDashboardArgs> =
    useCallback(
      async (args) => {
        const method = args.dashboardId === "new" ? "POST" : "PUT";
        const url =
          method === "POST" ? "/dashboards" : `/dashboards/${args.dashboardId}`;

        const res = await apiCall<{
          status: number;
          dashboard: DashboardInterface;
        }>(url, {
          method,
          body: JSON.stringify(
            method === "POST"
              ? {
                  title: args.data.title || dashboard.title,
                  editLevel: args.data.editLevel || dashboard.editLevel,
                  shareLevel: args.data.shareLevel || dashboard.shareLevel,
                  enableAutoUpdates:
                    args.data.enableAutoUpdates ?? dashboard.enableAutoUpdates,
                  experimentId: "",
                  projects: dashboard.projects || [],
                  blocks: args.data.blocks || dashboard.blocks,
                  updateSchedule:
                    args.data.updateSchedule || dashboard.updateSchedule,
                  userId: args.data.userId || dashboard.userId,
                }
              : {
                  blocks: args.data.blocks,
                  title: args.data.title ?? dashboard.title,
                  shareLevel: args.data.shareLevel ?? dashboard.shareLevel,
                  editLevel: args.data.editLevel ?? dashboard.editLevel,
                  enableAutoUpdates:
                    args.data.enableAutoUpdates ?? dashboard.enableAutoUpdates,
                  updateSchedule:
                    args.data.updateSchedule ?? dashboard.updateSchedule,
                  userId: args.data.userId,
                },
          ),
        });

        setDashboard(res.dashboard);
        return { dashboardId: res.dashboard.id };
      },
      [apiCall, dashboard],
    );

  const handleClose = useCallback(
    (savedDashboardId?: string) => {
      if (savedDashboardId) {
        // If we have a saved dashboard ID, navigate to it
        router.push(`/product-analytics/dashboards/${savedDashboardId}`);
      } else if (dashboard.id === "new") {
        // If the user hasn't saved the dashboard, navigate back to the dashboards list
        router.push("/product-analytics/dashboards");
      } else {
        // Navigate to the dashboard page
        router.push(`/product-analytics/dashboards/${dashboard.id}`);
      }
    },
    [dashboard.id, router],
  );

  if (!hasCommercialFeature("product-analytics-dashboards")) {
    return (
      <div className="p-3 container-fluid pagecontents">
        <PremiumCallout
          id="product-analytics-new-dashboard"
          dismissable={false}
          commercialFeature="product-analytics-dashboards"
        >
          Use of Product Analytics Dashboards requires a paid plan
        </PremiumCallout>
      </div>
    );
  }

  return (
    <DashboardSnapshotProvider
      experiment={undefined}
      dashboard={dashboard}
      mutateDefinitions={mutateDashboards}
    >
      <DashboardSeriesDisplayProvider
        dashboard={dashboard}
        //MKTODO: Do I need to handle onSave differently or take in the updateTemporaryDashboard function here?
        onSave={async (updatedSettings) => {
          // Only save if dashboard has been created (not "new")
          if (dashboard?.id && dashboard.id !== "new") {
            await handleSubmitDashboard({
              method: "PUT",
              dashboardId: dashboard.id,
              data: {
                seriesDisplaySettings: updatedSettings,
              },
            });
          }
        }}
      >
        <DashboardWorkspace
          isTabActive={true}
          experiment={null}
          dashboard={dashboard}
          mutate={mutateDashboards}
          submitDashboard={handleSubmitDashboard}
          close={handleClose}
          dashboardFirstSave={true}
          updateTemporaryDashboard={(update: {
            blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
          }) => {
            setDashboard((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                ...(update.blocks !== undefined
                  ? { blocks: update.blocks }
                  : {}),
              } as DashboardInterface;
            });
          }}
        />
      </DashboardSeriesDisplayProvider>
    </DashboardSnapshotProvider>
  );
}
