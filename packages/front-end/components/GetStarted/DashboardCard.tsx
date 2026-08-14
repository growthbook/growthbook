import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import {
  useDefinitions,
  LOCALSTORAGE_DASHBOARD_KEY,
} from "@/services/DefinitionsContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDashboards } from "@/hooks/useDashboards";
import DashboardSelector from "@/enterprise/components/Dashboards/DashboardSelector";
import DashboardView from "@/enterprise/components/Dashboards/DashboardView";

const PREVIEW_HEIGHT = "280px";

// Resolution order: the user's own localStorage pick, then the project's
// admin-configured default, then nothing selected. The selector itself always
// shows (as long as candidate dashboards exist) so a project without a
// default yet is still discoverable/pickable from the home page.
export default function DashboardCard() {
  const { project, getProjectById } = useDefinitions();
  const { dashboards, loading } = useDashboards(false);
  const [selectedDashboardId, setSelectedDashboardId] = useLocalStorage(
    LOCALSTORAGE_DASHBOARD_KEY,
    "",
  );

  const projectDashboards = useMemo(
    () =>
      dashboards.filter(
        (d) => !d.projects?.length || d.projects.includes(project),
      ),
    [dashboards, project],
  );

  const projectDefaultDashboardId =
    getProjectById(project)?.settings?.defaultDashboardId;

  const resolvedDashboardId = useMemo(() => {
    if (
      selectedDashboardId &&
      projectDashboards.some((d) => d.id === selectedDashboardId)
    ) {
      return selectedDashboardId;
    }
    if (
      projectDefaultDashboardId &&
      projectDashboards.some((d) => d.id === projectDefaultDashboardId)
    ) {
      return projectDefaultDashboardId;
    }
    return "";
  }, [selectedDashboardId, projectDefaultDashboardId, projectDashboards]);

  if (loading || projectDashboards.length === 0) {
    return null;
  }

  return (
    <Box mt="5" mb="5">
      <Flex align="center" justify="between" mb="3">
        <Heading as="h4" size="sm">
          Dashboard
        </Heading>
        <DashboardSelector
          dashboards={projectDashboards}
          value={resolvedDashboardId}
          setValue={setSelectedDashboardId}
          style={{ minWidth: "240px" }}
        />
      </Flex>
      {resolvedDashboardId ? (
        <Box
          p="4"
          style={{
            maxHeight: PREVIEW_HEIGHT,
            overflow: "auto",
            border: "1px solid var(--slate-a4)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <DashboardView dashboardId={resolvedDashboardId} />
        </Box>
      ) : (
        <Text color="text-mid">
          Select a dashboard above to preview it here.
        </Text>
      )}
    </Box>
  );
}
