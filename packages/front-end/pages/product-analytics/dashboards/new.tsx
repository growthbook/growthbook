import React, { useState, useCallback } from "react";
import { useRouter } from "next/router";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import {
  SubmitDashboard,
  UpdateDashboardArgs,
} from "@/enterprise/components/Dashboards/DashboardsTab";
import PremiumCallout from "@/ui/PremiumCallout";
import { useDashboards } from "@/hooks/useDashboards";

export default function NewDashboardPage() {
  const { project } = useDefinitions();
  const { userId, hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();
  const router = useRouter();
  const { mutateDashboards } = useDashboards(false);

  // Create a temporary dashboard object for the new dashboard
  const createTemporaryDashboard = useCallback((): DashboardInterface => {
    const now = new Date();
    return {
      id: "new",
      uid: "new",
      organization: "", // Will be set by backend
      experimentId: "",
      isDefault: false,
      isDeleted: false,
      userId: userId || "",
      editLevel: "private",
      shareLevel: "private",
      enableAutoUpdates: false,
      title: "Untitled Dashboard",
      blocks: [],
      projects: project ? [project] : [],
      dateCreated: now,
      dateUpdated: now,
    };
  }, [project, userId]);

  const [dashboard, setDashboard] = useState<DashboardInterface>(
    createTemporaryDashboard,
  );

  const handleSubmitDashboard: SubmitDashboard<UpdateDashboardArgs> =
    useCallback(
      async (args) => {
        console.log("args", args);
        // If dashboardId is "new", we need to create the dashboard (POST)
        if (args.dashboardId === "new") {
          const res = await apiCall<{
            status: number;
            dashboard: DashboardInterface;
          }>("/dashboards", {
            method: "POST",
            body: JSON.stringify({
              title: dashboard.title,
              editLevel: dashboard.editLevel,
              shareLevel: dashboard.shareLevel,
              enableAutoUpdates: dashboard.enableAutoUpdates,
              experimentId: "",
              projects: dashboard.projects || [],
              blocks: args.data.blocks || dashboard.blocks,
            }),
          });

          if (res.status === 200) {
            setDashboard(res.dashboard);
          } else {
            console.error(res);
            throw new Error("Failed to create dashboard");
          }
        } else {
          // Otherwise, update as normal
          const res = await apiCall<{
            status: number;
            dashboard: DashboardInterface;
          }>(`/dashboards/${args.dashboardId}`, {
            method: "PUT",
            body: JSON.stringify({
              blocks: args.data.blocks,
              title: args.data.title ?? dashboard.title,
              editLevel: args.data.editLevel ?? dashboard.editLevel,
              enableAutoUpdates:
                args.data.enableAutoUpdates ?? dashboard.enableAutoUpdates,
            }),
          });

          if (res.status === 200) {
            setDashboard(res.dashboard);
          } else {
            console.error(res);
            throw new Error("Failed to update dashboard");
          }
        }
      },
      [apiCall, dashboard],
    );

  const handleClose = useCallback(() => {
    if (dashboard.id === "new" && dashboard.blocks.length === 0) {
      // If the user hasn't saved the dashboard, navigate back to the dashboards list
      router.push("/product-analytics/dashboards");
    } else {
      // Navigate to the dashboard page
      router.push(`/product-analytics/dashboards/${dashboard.id}`);
    }
  }, [dashboard, router]);

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
    <DashboardWorkspace
      isTabActive={true}
      experiment={null}
      dashboard={dashboard}
      mutate={mutateDashboards}
      submitDashboard={handleSubmitDashboard}
      close={handleClose}
    />
  );
}
