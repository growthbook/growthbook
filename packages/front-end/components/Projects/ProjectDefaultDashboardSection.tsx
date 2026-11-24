import { useMemo, useState } from "react";
import {
  isDashboardEligibleAsProjectDefault,
  isProjectDefaultDashboard,
} from "shared/enterprise";
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
import { useSetProjectDefaultDashboard } from "@/hooks/useSetProjectDefaultDashboard";

// Picks a Project's default dashboard. Saves on change, separately from the
// Project's stats settings form.
export default function ProjectDefaultDashboardSection({
  projectId: pid,
  defaultDashboardId,
}: {
  projectId: string;
  defaultDashboardId: string | undefined;
}) {
  const setProjectDefaultDashboard = useSetProjectDefaultDashboard();
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
  // Project no longer counts; flag it here, don't clear it.
  const savedDefaultDashboardId =
    dashboards.find((d) =>
      isProjectDefaultDashboard({ id: pid, defaultDashboardId }, d),
    )?.id ?? "";
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
      await setProjectDefaultDashboard(pid, dashboardId || null);
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
            Dashboards
          </Heading>
        </Box>
        <Flex align="start" direction="column" flexGrow="1">
          <Flex direction="column" gap="3" mb="3" width="100%">
            <Heading as="h5" size="sm">
              Default Dashboard
            </Heading>
            <Text as="p">
              Choose a default dashboard for this Project. Changes save
              immediately.
            </Text>
            {dashboardError && (
              <Callout status="error">{dashboardError}</Callout>
            )}
            {defaultDashboardUnavailable && (
              <Callout status="warning">
                The dashboard chosen as this Project&apos;s default is no longer
                available. Choose another one or clear it.
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
                {/* A new tab keeps unsaved edits to the form above. */}
                <Link href="/product-analytics/dashboards/new" external>
                  Create a dashboard
                </Link>{" "}
                scoped to this Project (or with no Project restriction) to set a
                default.
              </Callout>
            ) : (
              <DashboardSelector
                aria-label="Default dashboard"
                placeholder="No default"
                dashboards={projectDashboards}
                value={pendingDashboardId ?? savedDefaultDashboardId ?? ""}
                setValue={setDefaultDashboard}
                disabled={savingDashboard}
              />
            )}
            {/* Also clears a stored default that is no longer available, which
                the select can't show. */}
            {defaultDashboardId && (
              <Button
                variant="ghost"
                size="sm"
                disabled={savingDashboard}
                onClick={() => setDefaultDashboard("")}
              >
                Clear default
              </Button>
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
