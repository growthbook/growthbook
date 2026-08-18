import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import {
  useDefinitions,
  LOCALSTORAGE_DASHBOARD_KEY,
} from "@/services/DefinitionsContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDashboards } from "@/hooks/useDashboards";
import DashboardSelector from "@/enterprise/components/Dashboards/DashboardSelector";
import DashboardView from "@/enterprise/components/Dashboards/DashboardView";

// Cap the number of blocks shown, rather than shrinking/scrolling a full
// dashboard, so everything visible fits at its native (author-configured)
// size. See DashboardView for the "View full dashboard" link this implies.
const PREVIEW_MAX_BLOCKS = 2;

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
          placeholder="Select a dashboard"
        />
      </Flex>
      {resolvedDashboardId ? (
        <Frame
          position="relative"
          pt="1"
          pb="4"
          px="4"
          mb="0"
          style={{ minHeight: "160px" }}
        >
          <DashboardView
            dashboardId={resolvedDashboardId}
            maxBlocks={PREVIEW_MAX_BLOCKS}
          />
        </Frame>
      ) : (
        <Text color="text-mid">
          Select a dashboard above to preview it here.
        </Text>
      )}
    </Box>
  );
}
