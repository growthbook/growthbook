import { useMemo } from "react";
import { isProjectListValidForProject } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDashboards } from "@/hooks/useDashboards";
import { useUser } from "@/services/UserContext";
import DashboardSelector from "@/enterprise/components/Dashboards/DashboardSelector";
import DashboardView from "@/enterprise/components/Dashboards/DashboardView";

const PREVIEW_MAX_BLOCKS = 2;
const DASHBOARD_PICKS_KEY = "gb_selected_dashboard";

export default function DashboardCard() {
  const { hasCommercialFeature } = useUser();
  const canViewDashboards = hasCommercialFeature("dashboards");
  const { project, getProjectById } = useDefinitions();
  const { dashboards, loading, mutateDashboards } = useDashboards(
    false,
    () => canViewDashboards,
  );
  const [picks, setPicks] = useLocalStorage<Record<string, string>>(
    DASHBOARD_PICKS_KEY,
    {},
  );

  const projectDashboards = useMemo(
    () =>
      dashboards.filter((d) =>
        isProjectListValidForProject(d.projects, project),
      ),
    [dashboards, project],
  );

  const projectDefaultDashboardId =
    getProjectById(project)?.settings?.defaultDashboardId;
  const selectedDashboardId = picks[project] ?? "";

  const projectDefaultDashboard = useMemo(
    () => projectDashboards.find((d) => d.id === projectDefaultDashboardId),
    [projectDashboards, projectDefaultDashboardId],
  );
  const resolvedDashboard = useMemo(
    () =>
      projectDashboards.find((d) => d.id === selectedDashboardId) ??
      projectDefaultDashboard,
    [selectedDashboardId, projectDefaultDashboard, projectDashboards],
  );

  if (!canViewDashboards || loading || projectDashboards.length === 0) {
    return null;
  }

  return (
    <Box mt="5" mb="5">
      <Flex align="center" justify="between" wrap="wrap" gap="2" mb="3">
        <Heading as="h4" size="sm">
          Dashboard
        </Heading>
        <DashboardSelector
          dashboards={projectDashboards}
          defaultDashboard={projectDefaultDashboard}
          value={resolvedDashboard?.id ?? ""}
          allowClear={!!selectedDashboardId}
          clearLabel={
            projectDefaultDashboard ? "Use Project default" : "Clear selection"
          }
          setValue={(id) => {
            setPicks((prev) => {
              const next = { ...prev };
              if (!id || id === projectDefaultDashboardId) {
                delete next[project];
              } else {
                next[project] = id;
              }
              return next;
            });
          }}
          style={{ minWidth: "240px" }}
          placeholder="Select a dashboard"
        />
      </Flex>
      {resolvedDashboard ? (
        <Frame
          position="relative"
          pt="1"
          pb="4"
          px="4"
          mb="0"
          style={{ minHeight: "160px" }}
        >
          <DashboardView
            dashboard={resolvedDashboard}
            maxBlocks={PREVIEW_MAX_BLOCKS}
            mutate={mutateDashboards}
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
