import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

// The one client write for a Project's default dashboard. It throws the
// server's error, so each caller shows it on the control that failed.
export function useSetProjectDefaultDashboard() {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  return async (projectId: string, dashboardId: string | null) => {
    await apiCall(`/projects/${projectId}/default-dashboard`, {
      method: "PUT",
      body: JSON.stringify({ defaultDashboardId: dashboardId }),
    });
    await mutateDefinitions();
  };
}
