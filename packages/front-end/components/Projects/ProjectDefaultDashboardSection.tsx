import { useMemo, useState } from "react";
import { isDashboardEligibleAsProjectDefault } from "shared/enterprise";
import { Box, Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import TempMessage from "@/components/TempMessage";
import DashboardSelector from "@/enterprise/components/Dashboards/DashboardSelector";
import { useDashboards } from "@/hooks/useDashboards";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

// Picks a project's home page dashboard. Saves on change, separately from the
// project's stats settings form.
export default function ProjectDefaultDashboardSection({
  projectId: pid,
  defaultDashboardId,
}: {
  projectId: string;
  defaultDashboardId: string | undefined;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const {
    dashboards,
    loading: dashboardsLoading,
    error: dashboardsError,
  } = useDashboards(false);
  // Only a successful read can show that a dashboard is missing.
  const dashboardsLoaded = !dashboardsLoading && !dashboardsError;
  const projectDashboards = useMemo(
    () => dashboards.filter((d) => isDashboardEligibleAsProjectDefault(d, pid)),
    [dashboards, pid],
  );
  // A stored default that was deleted, made private, or moved out of this
  // project is ignored on the home page; flag it here, don't clear it.
  const savedDefaultDashboardId = projectDashboards.some(
    (d) => d.id === defaultDashboardId,
  )
    ? defaultDashboardId
    : "";
  const defaultDashboardUnavailable =
    dashboardsLoaded && !!defaultDashboardId && !savedDefaultDashboardId;

  const [savingDashboard, setSavingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardSavedMsg, setDashboardSavedMsg] = useState<string | null>(
    null,
  );
  // Shown while the save is in flight so the controlled select doesn't snap
  // back to the old value until definitions refresh.
  const [pendingDashboardId, setPendingDashboardId] = useState<string | null>(
    null,
  );
  const setDefaultDashboard = async (dashboardId: string) => {
    setSavingDashboard(true);
    setPendingDashboardId(dashboardId);
    setDashboardError(null);
    setDashboardSavedMsg(null);
    try {
      await apiCall(`/projects/${pid}/default-dashboard`, {
        method: "PUT",
        body: JSON.stringify({ defaultDashboardId: dashboardId || null }),
      });
      await mutateDefinitions();
      setDashboardSavedMsg(
        dashboardId ? "Default dashboard saved" : "Default dashboard cleared",
      );
    } catch (error) {
      setDashboardError(
        error instanceof Error
          ? error.message
          : "Failed to update the default dashboard.",
      );
    } finally {
      setSavingDashboard(false);
      setPendingDashboardId(null);
    }
  };

  return (
    <Frame>
      <Flex gap="4" mb="4">
        <Box width="220px" flexShrink="0">
          <Heading as="h4" size="md">
            Home Page Dashboard
          </Heading>
        </Box>
        <Flex align="start" direction="column" flexGrow="1">
          <Flex direction="column" gap="3" mb="3" width="100%">
            <Heading as="h5" size="sm">
              Default Dashboard
            </Heading>
            <Text as="p">
              Members of this Project see this dashboard on their home page by
              default. They can still pick a different one for themselves.
              Changes save immediately.
            </Text>
            {dashboardError && (
              <Callout status="error">{dashboardError}</Callout>
            )}
            {defaultDashboardUnavailable && (
              <Callout
                status="warning"
                action={
                  // The select already shows "No default" here, so it can't
                  // send the clear request itself.
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={savingDashboard}
                    onClick={() => setDefaultDashboard("")}
                  >
                    Clear default
                  </Button>
                }
              >
                The dashboard chosen as this Project&apos;s default is no longer
                available, so the home page ignores it. Choose another one or
                clear it.
              </Callout>
            )}
            {dashboardsError ? (
              <Callout status="error">
                There was an error loading the list of dashboards.
              </Callout>
            ) : dashboardsLoading ? (
              <Text color="text-low">Loading dashboards…</Text>
            ) : projectDashboards.length === 0 ? (
              <Callout status="info">
                No dashboards are available for this Project yet.{" "}
                <Link href="/product-analytics/dashboards/new">
                  Create a dashboard
                </Link>{" "}
                scoped to this Project (or with no Project restriction) to set a
                default.
              </Callout>
            ) : (
              <DashboardSelector
                aria-label="Default dashboard"
                dashboards={projectDashboards}
                value={pendingDashboardId ?? savedDefaultDashboardId ?? ""}
                setValue={setDefaultDashboard}
                disabled={savingDashboard}
                allowClear
                clearLabel="No default"
              />
            )}
            {/* After the select, so the control doesn't move when it shows. */}
            {dashboardSavedMsg && (
              <TempMessage close={() => setDashboardSavedMsg(null)}>
                {dashboardSavedMsg}
              </TempMessage>
            )}
          </Flex>
        </Flex>
      </Flex>
    </Frame>
  );
}
