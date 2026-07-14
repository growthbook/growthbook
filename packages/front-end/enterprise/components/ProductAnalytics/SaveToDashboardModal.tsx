import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { Flex, Box } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import {
  DEFAULT_DASHBOARD_GLOBAL_CONTROLS,
  DashboardInterface,
  DashboardEditLevel,
  DashboardShareLevel,
  DashboardUpdateSchedule,
  getBlockData,
} from "shared/enterprise";
import {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useDashboards } from "@/hooks/useDashboards";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  defaultUpdateSchedules,
  defaultFormInit,
} from "@/enterprise/components/Dashboards/DashboardModal";
import { useCronValidation } from "@/enterprise/components/Dashboards/useCronValidation";
import DashboardUpdateScheduleSelector from "@/enterprise/components/Dashboards/DashboardUpdateScheduleSelector";
import track from "@/services/track";

function datasetTypeToBlockType(
  type: "metric" | "fact_table" | "data_source" | "funnel",
):
  | "metric-exploration"
  | "fact-table-exploration"
  | "data-source-exploration"
  | "funnel-exploration" {
  switch (type) {
    case "metric":
      return "metric-exploration";
    case "fact_table":
      return "fact-table-exploration";
    case "data_source":
      return "data-source-exploration";
    case "funnel":
      return "funnel-exploration";
  }
}

interface Props {
  close: () => void;
  config: ExplorationConfig;
  exploration: ProductAnalyticsExploration | null;
  /** Whether the explorer is currently comparing periods. */
  compareEnabled?: boolean;
  /** The comparison (previous) window the explorer submitted, if any. */
  previousTimeFrame?: ExplorationDateRange | null;
  /** Current comparison exploration id, to seed the block before first refresh. */
  comparisonExplorationId?: string | null;
  trackingSource?: string;
}

export default function SaveToDashboardModal({
  close,
  config,
  exploration,
  compareEnabled = false,
  previousTimeFrame = null,
  comparisonExplorationId = null,
  trackingSource,
}: Props) {
  const router = useRouter();
  const { dashboards, dashboardsMap, mutateDashboards } = useDashboards(false);
  const { projects, project } = useDefinitions();
  const { hasCommercialFeature, permissionsUtil } = useUser();
  const { apiCall } = useAuth();

  const [createOrAdd, setCreateOrAdd] = useState<"new" | "existing">(
    dashboards.length === 0 ? "new" : "existing",
  );
  const [selectedDashboardId, setSelectedDashboardId] = useState<
    string | undefined
  >(undefined);

  const hasSharing = hasCommercialFeature("share-product-analytics-dashboards");

  const form = useForm<{
    title: string;
    chartTitle: string;
    shareLevel: DashboardShareLevel;
    editLevel: DashboardEditLevel;
    enableAutoUpdates: boolean;
    updateSchedule?: DashboardUpdateSchedule;
    projects: string[];
  }>({
    defaultValues: {
      ...defaultFormInit,
      enableAutoUpdates: true,
      updateSchedule: defaultUpdateSchedules.stale,
      projects: project ? [project] : [],
      chartTitle: "",
    },
  });

  const currentUpdateSchedule = form.watch("updateSchedule");
  const { cronString, cronError } = useCronValidation(currentUpdateSchedule);

  const projectsOptions = projects.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  const handleSubmit = async () => {
    const blockType = datasetTypeToBlockType(config.dataset.type);
    // Persist the comparison so dashboards can show it and roll it on refresh.
    // Only store `previousTimeFrame` for a fixed (custom date range) primary;
    // relative primaries re-derive the previous window each refresh so it rolls.
    const comparison = compareEnabled
      ? {
          enabled: true,
          previousTimeFrame:
            config.dateRange.predefined === "customDateRange"
              ? (previousTimeFrame ?? undefined)
              : undefined,
        }
      : undefined;
    const newBlock = {
      type: blockType,
      title: form.watch("chartTitle"),
      description: "",
      explorerAnalysisId: exploration?.id ?? "",
      config,
      ...(comparison ? { comparison } : {}),
      ...(comparison && comparisonExplorationId
        ? { comparisonExplorerAnalysisId: comparisonExplorationId }
        : {}),
    };

    let dashboardId: string;

    if (createOrAdd === "new") {
      const formValues = form.getValues();
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInterface;
      }>(`/dashboards`, {
        method: "POST",
        body: JSON.stringify({
          title: formValues.title,
          shareLevel: formValues.shareLevel,
          editLevel: formValues.editLevel,
          enableAutoUpdates: formValues.enableAutoUpdates,
          updateSchedule: formValues.updateSchedule,
          projects: formValues.projects,
          experimentId: "",
          blocks: [newBlock],
          globalControls: DEFAULT_DASHBOARD_GLOBAL_CONTROLS,
        }),
      });
      if (res.status !== 200) throw new Error("Failed to create dashboard");
      dashboardId = res.dashboard.id;
    } else {
      if (!selectedDashboardId) throw new Error("Please select a dashboard");
      const selectedDashboard = dashboardsMap.get(selectedDashboardId);
      if (!selectedDashboard) throw new Error("Dashboard not found");

      const updatedBlocks = [
        ...(selectedDashboard.blocks || []).map(getBlockData),
        newBlock,
      ];
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInterface;
      }>(`/dashboards/${selectedDashboardId}`, {
        method: "PUT",
        body: JSON.stringify({ blocks: updatedBlocks }),
      });
      if (res.status !== 200)
        throw new Error("Failed to add block to dashboard");
      dashboardId = selectedDashboardId;
    }

    mutateDashboards();

    if (trackingSource) {
      track("Product Analytics Explorer: Saved To Dashboard", {
        source: trackingSource,
        type: config.type,
        chart_type: config.chartType,
        target: createOrAdd === "new" ? "new-dashboard" : "existing-dashboard",
      });
    }

    router.push(`/product-analytics/dashboards/${dashboardId}`);
  };

  const ctaEnabled =
    !!form.watch("chartTitle").trim() &&
    (createOrAdd === "existing"
      ? !!selectedDashboardId
      : !!form.watch("title").trim() && !cronError);

  return (
    <ModalStandard
      trackingEventModalType="save-to-dashboard"
      submit={handleSubmit}
      open={true}
      header="Save to Dashboard"
      cta={createOrAdd === "existing" ? "Add to Dashboard" : "Create Dashboard"}
      ctaEnabled={ctaEnabled}
      close={close}
    >
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="2">
          <Text as="label" weight="semibold">
            Chart Title
          </Text>
          <Field placeholder="Chart title" {...form.register("chartTitle")} />
        </Flex>
        <Flex direction="column" gap="2">
          <Text as="label" weight="semibold">
            Save to...
          </Text>
          <RadioGroup
            options={[
              {
                label: "Existing dashboard",
                value: "existing",
                disabled: dashboards.length === 0,
              },
              {
                label: "New dashboard",
                value: "new",
                disabled:
                  !permissionsUtil.canCreateGeneralDashboards({
                    projects: [project],
                  }) ||
                  !permissionsUtil.canCreateGeneralDashboards({ projects: [] }),
              },
            ]}
            value={createOrAdd}
            setValue={(value) => setCreateOrAdd(value as "new" | "existing")}
          />
        </Flex>
        {createOrAdd === "existing" ? (
          <SelectField
            options={dashboards
              .filter((dashboard) =>
                permissionsUtil.canUpdateGeneralDashboards(
                  { projects: dashboard.projects },
                  {},
                ),
              )
              .map((filteredDashboard) => ({
                label: filteredDashboard.title,
                value: filteredDashboard.id,
              }))}
            label="Select Existing Dashboard"
            value={selectedDashboardId || ""}
            onChange={(value) => setSelectedDashboardId(value)}
          />
        ) : (
          <Flex direction="column">
            <Field
              label="Name"
              placeholder="Dashboard name"
              {...form.register("title")}
            />
            <MultiSelectField
              label="Projects"
              placeholder="All projects"
              options={projectsOptions}
              value={form.watch("projects")}
              onChange={(value) => form.setValue("projects", value)}
            />
            <Box mt="2">
              <Collapsible
                trigger={
                  <Link className="font-weight-bold">
                    <Text>
                      <PiCaretRightFill className="chevron mr-1" />
                      Advanced Settings
                    </Text>
                  </Link>
                }
                open={false}
                transitionTime={100}
              >
                <Box className="bg-highlight rounded p-3" mt="3">
                  <Flex direction="column" gap="4">
                    <SelectField
                      label="View access"
                      containerClassName="mb-0"
                      disabled={!hasSharing}
                      helpText={
                        !hasSharing
                          ? "Your organization's plan does not support sharing dashboards"
                          : undefined
                      }
                      options={[
                        { label: "Organization members", value: "published" },
                        { label: "Only me", value: "private" },
                      ]}
                      value={form.watch("shareLevel")}
                      onChange={(value) => {
                        form.setValue(
                          "shareLevel",
                          value as DashboardShareLevel,
                        );
                        if (value === "private")
                          form.setValue("editLevel", "private");
                      }}
                    />
                    <SelectField
                      label="Edit access"
                      containerClassName="mb-0"
                      disabled={
                        !hasSharing || form.watch("shareLevel") === "private"
                      }
                      helpText={
                        !hasSharing
                          ? "Your organization's plan does not support sharing dashboards"
                          : undefined
                      }
                      options={[
                        {
                          label:
                            "Any organization members with editing permission",
                          value: "published",
                        },
                        { label: "Only me", value: "private" },
                      ]}
                      value={form.watch("editLevel")}
                      onChange={(value) =>
                        form.setValue("editLevel", value as DashboardEditLevel)
                      }
                    />
                    <Checkbox
                      label="Auto-update dashboard data"
                      value={form.watch("enableAutoUpdates")}
                      setValue={(checked) => {
                        form.setValue("enableAutoUpdates", checked);
                        form.setValue(
                          "updateSchedule",
                          checked ? defaultUpdateSchedules.stale : undefined,
                        );
                      }}
                    />
                    {form.watch("enableAutoUpdates") && (
                      <DashboardUpdateScheduleSelector
                        currentUpdateSchedule={currentUpdateSchedule}
                        cronString={cronString}
                        cronError={cronError}
                        onHoursChange={(hours) =>
                          form.setValue("updateSchedule.hours", hours)
                        }
                        onCronChange={(cron) =>
                          form.setValue("updateSchedule", {
                            type: "cron",
                            cron,
                          })
                        }
                        onScheduleTypeChange={(type) =>
                          form.setValue(
                            "updateSchedule",
                            defaultUpdateSchedules[type],
                          )
                        }
                      />
                    )}
                  </Flex>
                </Box>
              </Collapsible>
            </Box>
          </Flex>
        )}
      </Flex>
    </ModalStandard>
  );
}
