import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DifferenceType } from "shared/types/stats";
import {
  DashboardInterface,
  getBlockData,
  CREATE_BLOCK_TYPE,
  DashboardEditLevel,
  DashboardShareLevel,
} from "shared/enterprise";
import { PiArrowSquareOut } from "react-icons/pi";
import cronstrue from "cronstrue";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import Metadata from "@/ui/Metadata";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { useExperimentDashboards } from "@/hooks/useDashboards";
import DashboardSelector from "@/enterprise/components/Dashboards/DashboardSelector";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import LinkButton from "@/ui/LinkButton";
import { getExperimentRefreshFrequency } from "@/services/env";
import { autoUpdateDisabledMessage } from "@/enterprise/components/Dashboards/DashboardsTab";

// Type for block comparison - only includes fields we compare
type BlockComparisonFields = {
  type?: string;
  dimensionId?: string;
  sliceTagsFilter?: string[];
  metricIds?: string[];
  metricTagFilter?: string[];
  variationIds?: string[];
  differenceType?: DifferenceType | string;
  sortBy?: string | null;
  sortDirection?: string | null;
  baselineRow?: number;
};

// Compare arrays order-agnostically
function arraysMatch(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

// Check if two blocks have nearly matching configuration
function blocksNearlyMatch(
  block1: BlockComparisonFields,
  block2: BlockComparisonFields,
): boolean {
  if (block1.type !== block2.type) return false;
  if (block1.dimensionId !== block2.dimensionId) return false;
  if (!arraysMatch(block1.sliceTagsFilter, block2.sliceTagsFilter))
    return false;
  if (!arraysMatch(block1.metricIds, block2.metricIds)) return false;
  if (!arraysMatch(block1.metricTagFilter, block2.metricTagFilter))
    return false;
  if (!arraysMatch(block1.variationIds, block2.variationIds)) return false;
  if (block1.differenceType !== block2.differenceType) return false;
  if (block1.sortBy !== block2.sortBy) return false;
  if (block1.sortDirection !== block2.sortDirection) return false;
  return true;
}

export interface MigrateResultsToDashboardModalProps {
  open: boolean;
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  dimension?: string;
  metricTagFilter?: string[];
  metricsFilter?: string[];
  sliceTagsFilter?: string[];
  baselineRow?: number;
  variationFilter?: number[];
  sortBy?: string | null;
  sortDirection?: string | null;
  differenceType?: DifferenceType;
}

export default function MigrateResultsToDashboardModal({
  open,
  close,
  experiment,
  dimension,
  metricTagFilter = [],
  metricsFilter = [],
  sliceTagsFilter = [],
  baselineRow,
  variationFilter,
  sortBy,
  sortDirection,
  differenceType,
}: MigrateResultsToDashboardModalProps) {
  const { getDimensionById, metricGroups } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const {
    userId,
    hasCommercialFeature,
    settings: { updateSchedule },
  } = useUser();
  const { apiCall } = useAuth();
  const defaultRefreshInterval = getExperimentRefreshFrequency();

  const {
    dashboards,
    loading: loadingDashboards,
    mutateDashboards,
  } = useExperimentDashboards(experiment.id);

  const isBandit = experiment.type === "multi-armed-bandit";

  const filteredDashboards = useMemo(() => {
    return dashboards.filter((dash) => {
      const isOwner = dash.userId === userId;
      const isAdmin = permissionsUtil.canManageOrgSettings();

      if (isOwner) return true;
      const canEdit = permissionsUtil.canViewReportModal(experiment.project);
      if (dash.editLevel === "private" && !isAdmin) {
        return false;
      }
      return canEdit;
    });
  }, [dashboards, userId, permissionsUtil, experiment.project]);

  const defaultDashboard = filteredDashboards.find((dash) => dash.isDefault);

  const dimensionName = dimension
    ? getDimensionById(dimension)?.name ||
      dimension?.split(":")?.[1] ||
      dimension
    : "None";

  // Generate default block name based on block type
  const getDefaultBlockName = useCallback(
    (
      blockType:
        | "experiment-metric"
        | "experiment-time-series"
        | "experiment-dimension",
    ) => {
      if (blockType === "experiment-dimension") {
        return dimensionName !== "None"
          ? `Dimension Results: ${dimensionName}`
          : "Dimension Results";
      }
      if (blockType === "experiment-time-series") {
        return "Timeseries Results";
      }
      return "Metric Results";
    },
    [dimensionName],
  );

  const getDefaultFormValues = useCallback((): {
    dashboardId: string;
    isCreatingNew: boolean;
    blockType:
      | "experiment-metric"
      | "experiment-time-series"
      | "experiment-dimension";
    blockName: string;
    newDashboardTitle: string;
    newDashboardShareLevel: DashboardShareLevel;
    newDashboardEditLevel: DashboardEditLevel;
    newDashboardEnableAutoUpdates: boolean;
  } => {
    const initialBlockType:
      | "experiment-metric"
      | "experiment-time-series"
      | "experiment-dimension" = dimension
      ? "experiment-dimension"
      : "experiment-metric";
    return {
      dashboardId: "",
      isCreatingNew: false,
      blockType: initialBlockType,
      blockName: getDefaultBlockName(initialBlockType),
      newDashboardTitle: "Untitled Dashboard",
      newDashboardShareLevel: "published" as DashboardShareLevel,
      newDashboardEditLevel: "private" as DashboardEditLevel,
      newDashboardEnableAutoUpdates: false,
    };
  }, [dimension, getDefaultBlockName]);

  const defaultFormValues = getDefaultFormValues();

  const form = useForm<{
    dashboardId: string;
    isCreatingNew: boolean;
    blockType:
      | "experiment-metric"
      | "experiment-time-series"
      | "experiment-dimension";
    blockName: string;
    newDashboardTitle: string;
    newDashboardShareLevel: DashboardShareLevel;
    newDashboardEditLevel: DashboardEditLevel;
    newDashboardEnableAutoUpdates: boolean;
  }>({
    defaultValues: defaultFormValues,
  });

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedDashboardId, setSavedDashboardId] = useState<string | null>(null);
  const [wasCreatingNew, setWasCreatingNew] = useState(false);

  const canCreate = permissionsUtil.canCreateReport(experiment);

  const dashboardId = form.watch("dashboardId");
  const isCreatingNew = form.watch("isCreatingNew");
  const blockType = form.watch("blockType");
  const blockName = form.watch("blockName");
  const defaultBlockName = useMemo(
    () => getDefaultBlockName(blockType),
    [blockType, getDefaultBlockName],
  );

  const refreshInterval = useMemo(() => {
    if (!updateSchedule) return `every ${defaultRefreshInterval} hours`;
    if (updateSchedule.type === "never") return;
    if (updateSchedule.type === "stale")
      return updateSchedule.hours
        ? `every ${updateSchedule.hours} hours`
        : undefined;
    if (updateSchedule.cron) {
      const cronString = cronstrue.toString(updateSchedule.cron, {
        verbose: false,
      });
      return cronString.charAt(0).toLowerCase() + cronString.slice(1);
    }
  }, [updateSchedule, defaultRefreshInterval]);

  // Initialize dashboardId with default or first available
  useEffect(() => {
    if (!dashboardId && filteredDashboards.length > 0) {
      form.setValue(
        "dashboardId",
        defaultDashboard?.id ?? filteredDashboards[0].id,
      );
    }
  }, [dashboardId, filteredDashboards, defaultDashboard, form]);

  // Update block name when block type changes
  useEffect(() => {
    form.setValue("blockName", defaultBlockName);
  }, [defaultBlockName, form]);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setError(null);
      setSavedDashboardId(null);
      setWasCreatingNew(false);
      form.reset(getDefaultFormValues());
    }
  }, [open, form, getDefaultFormValues]);

  const handleCreateNew = () => {
    if (!hasCommercialFeature("dashboards")) {
      setShowUpgradeModal(true);
      return;
    }
    if (canCreate) {
      form.setValue("isCreatingNew", true);
      form.setValue("dashboardId", "__create__");
    }
  };

  const handleDashboardSelect = (value: string) => {
    if (value === "__create__") {
      handleCreateNew();
    } else {
      form.setValue("isCreatingNew", false);
      form.setValue("dashboardId", value);
    }
  };

  const metricTagCount = metricTagFilter?.length || 0;
  const metricsCount = metricsFilter?.length || 0;
  const sliceTagsCount = sliceTagsFilter?.length || 0;

  const baselineText = useMemo(() => {
    if (baselineRow === undefined || !experiment.variations[baselineRow]) {
      return null;
    }
    const variation = experiment.variations[baselineRow];
    return `${baselineRow} - ${variation.name}`;
  }, [baselineRow, experiment.variations]);

  const variationsText = useMemo(() => {
    const baselineIndex = baselineRow ?? 0;
    const visibleIndices = experiment.variations
      .map((_, index) => index)
      .filter(
        (index) =>
          index !== baselineIndex &&
          (!variationFilter || !variationFilter.includes(index)),
      );
    const totalVariations = experiment.variations.length - 1;

    if (
      visibleIndices.length === 0 ||
      visibleIndices.length === totalVariations
    ) {
      return "All variations";
    }
    return visibleIndices.map((index) => `#${index}`).join(", ");
  }, [variationFilter, experiment.variations, baselineRow]);

  const sortByDisplay = useMemo(() => {
    if (sortBy === "metrics") return "Metric order";
    if (sortBy === "significance") return "Significance";
    if (sortBy === "change") return "Change";
    return "Default";
  }, [sortBy]);

  const sortDirectionDisplay = useMemo(() => {
    if (sortDirection === "asc") return "Ascending";
    if (sortDirection === "desc") return "Descending";
    return "";
  }, [sortDirection]);

  const differenceTypeDisplay = useMemo(() => {
    if (differenceType === "absolute") return "Absolute";
    if (differenceType === "scaled") return "Scaled";
    return "Relative";
  }, [differenceType]);

  // Check if the new block would match an existing block in the selected dashboard
  const hasMatchingBlock = useMemo(() => {
    if (!dashboardId) return false;

    const selectedDashboard = dashboards.find((d) => d.id === dashboardId);
    if (!selectedDashboard || !selectedDashboard.blocks) return false;

    // Map sortBy: "metrics" is used consistently in both experiment results and dashboards
    const mappedSortBy: "metrics" | "significance" | "change" | null =
      sortBy === "metrics" || sortBy === "significance" || sortBy === "change"
        ? (sortBy as "metrics" | "significance" | "change")
        : null;

    const mappedSortDirection: "asc" | "desc" | null =
      sortDirection === "asc" || sortDirection === "desc"
        ? (sortDirection as "asc" | "desc")
        : null;

    // Construct the new block structure for comparison
    const newBlockForComparison: BlockComparisonFields = {
      type: blockType,
      metricIds: metricsFilter || [],
      variationIds: (variationFilter || []).map(String),
      sliceTagsFilter: sliceTagsFilter || [],
      metricTagFilter: metricTagFilter || [],
      sortBy: mappedSortBy,
      sortDirection: mappedSortDirection,
      ...(blockType === "experiment-dimension" && {
        dimensionId: dimension || "",
        baselineRow: baselineRow ?? 0,
        differenceType: differenceType || "relative",
      }),
      ...(blockType === "experiment-metric" && {
        baselineRow: baselineRow ?? 0,
        differenceType: differenceType || "relative",
      }),
      ...(blockType === "experiment-time-series" && {
        differenceType: differenceType || "relative",
      }),
    };

    // Check if any existing block matches
    return selectedDashboard.blocks.some((existingBlock) =>
      blocksNearlyMatch(newBlockForComparison, existingBlock),
    );
  }, [
    dashboardId,
    dashboards,
    blockType,
    dimension,
    metricsFilter,
    variationFilter,
    sliceTagsFilter,
    metricTagFilter,
    sortBy,
    sortDirection,
    differenceType,
    baselineRow,
  ]);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!isCreatingNew && !dashboardId) return;
    if (isCreatingNew && !form.watch("newDashboardTitle").trim()) {
      setError("Dashboard name is required");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      // Map sortBy: "metrics" is used consistently in both experiment results and dashboards
      const mappedSortBy: "metrics" | "significance" | "change" | null =
        sortBy === "metrics" || sortBy === "significance" || sortBy === "change"
          ? (sortBy as "metrics" | "significance" | "change")
          : null;

      // Create the new block using CREATE_BLOCK_TYPE, then override with our values
      const baseBlock = CREATE_BLOCK_TYPE[blockType]({
        experiment,
        metricGroups,
      });

      const mappedSortDirection: "asc" | "desc" | null =
        sortDirection === "asc" || sortDirection === "desc"
          ? (sortDirection as "asc" | "desc")
          : null;

      const newBlock = {
        ...baseBlock,
        title: blockName || defaultBlockName,
        metricIds: metricsFilter || [],
        variationIds: (variationFilter || []).map(String),
        sliceTagsFilter: sliceTagsFilter || [],
        metricTagFilter: metricTagFilter || [],
        sortBy: mappedSortBy,
        sortDirection: mappedSortDirection,
        ...(blockType === "experiment-dimension" && {
          dimensionId: dimension || "",
          dimensionValues: [],
          baselineRow: baselineRow ?? 0,
          differenceType: differenceType || "relative",
        }),
        ...(blockType === "experiment-metric" && {
          baselineRow: baselineRow ?? 0,
          differenceType: differenceType || "relative",
        }),
      };

      let res: { status: number; dashboard: DashboardInterface };
      let finalDashboardId: string;

      if (isCreatingNew) {
        // Create new dashboard with the block included
        const blocks = [getBlockData(newBlock)];
        const formValues = form.getValues();
        res = await apiCall<{
          status: number;
          dashboard: DashboardInterface;
        }>(`/dashboards`, {
          method: "POST",
          body: JSON.stringify({
            title: formValues.newDashboardTitle,
            shareLevel: formValues.newDashboardShareLevel,
            editLevel: formValues.newDashboardEditLevel,
            enableAutoUpdates: formValues.newDashboardEnableAutoUpdates,
            experimentId: experiment.id,
            projects: experiment.project ? [experiment.project] : [],
            userId: userId,
            blocks,
          }),
        });
        finalDashboardId = res.dashboard.id;
      } else {
        // Update existing dashboard
        const selectedDashboard = dashboards.find((d) => d.id === dashboardId);
        if (!selectedDashboard) {
          setError("Dashboard not found");
          setIsSubmitting(false);
          return;
        }

        const updatedBlocks = [
          ...(selectedDashboard.blocks || []).map(getBlockData),
          getBlockData(newBlock),
        ];

        res = await apiCall<{
          status: number;
          dashboard: DashboardInterface;
        }>(`/dashboards/${dashboardId}`, {
          method: "PUT",
          body: JSON.stringify({
            blocks: updatedBlocks,
          }),
        });
        finalDashboardId = dashboardId;
      }

      if (res.status === 200) {
        await mutateDashboards();
        setSavedDashboardId(finalDashboardId);
        setWasCreatingNew(isCreatingNew);
        // Don't close the modal - let user click "View Dashboard" or "Close"
      } else {
        setError("Failed to add block to dashboard");
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to add block to dashboard",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="migrate-results-to-dashboard"
          commercialFeature="dashboards"
        />
      )}
      <Modal
        open={open}
        close={close}
        header="Add Results View to Dashboard"
        subHeader="Capture the current settings of this Experiment Results view to use it in a Dashboard."
        trackingEventModalType="migrate-results-to-dashboard"
        trackingEventModalSource="experiment-results"
        size="lg"
        includeCloseCta={true}
        closeCta="Close"
        cta={savedDashboardId ? undefined : "Add to Dashboard"}
        submit={savedDashboardId ? undefined : handleSubmit}
        secondaryCTA={
          savedDashboardId ? (
            <LinkButton
              href={`/${isBandit ? "bandit" : "experiment"}/${experiment.id}#dashboards/${savedDashboardId}`}
              external={true}
              variant="outline"
            >
              View Dashboard <PiArrowSquareOut />
            </LinkButton>
          ) : undefined
        }
        ctaEnabled={
          savedDashboardId
            ? false
            : Boolean(
                isCreatingNew
                  ? form.watch("newDashboardTitle").trim()
                  : dashboardId &&
                      dashboardId !== "__create__" &&
                      dashboardId !== "",
              ) && !isSubmitting
        }
        loading={isSubmitting}
        useRadixButton={true}
        autoCloseOnSubmit={false}
      >
        {savedDashboardId ? (
          <Box>
            <Callout status="success" mt="2" mb="5">
              {wasCreatingNew
                ? "Dashboard created successfully!"
                : "Block added to dashboard successfully!"}
            </Callout>
            <Text>
              {wasCreatingNew
                ? `Your new dashboard has been created. Close this window to return to the ${isBandit ? "bandit" : "experiment"} results.`
                : `The results view has been added to the dashboard. Close this window to return to the ${isBandit ? "bandit" : "experiment"} results.`}
            </Text>
          </Box>
        ) : (
          <>
            <Box mb="6">
              {error && (
                <Callout status="error" mb="3">
                  {error}
                </Callout>
              )}

              <Box mb="4">
                <Text
                  weight="bold"
                  size="2"
                  className="mb-2"
                  style={{ display: "block" }}
                >
                  Select Dashboard
                </Text>

                <DashboardSelector
                  dashboards={filteredDashboards}
                  defaultDashboard={defaultDashboard}
                  value={isCreatingNew ? "__create__" : dashboardId}
                  setValue={handleDashboardSelect}
                  canCreate={canCreate}
                  onCreateNew={handleCreateNew}
                  showIcon={false}
                  disabled={
                    loadingDashboards || filteredDashboards.length === 0
                  }
                />
              </Box>

              {isCreatingNew && (
                <Box className="bg-highlight rounded" mt="4" p="3">
                  <Text
                    weight="bold"
                    size="2"
                    mb="3"
                    style={{ display: "block" }}
                  >
                    New Dashboard Settings
                  </Text>
                  <Flex direction="column" gap="3">
                    <Field
                      label="Name"
                      {...form.register("newDashboardTitle")}
                      placeholder="Dashboard name"
                    />
                    {refreshInterval && (
                      <Checkbox
                        label="Auto-update dashboard data"
                        description={`An automatic data refresh will occur ${refreshInterval}.`}
                        disabled={updateSchedule?.type === "never"}
                        disabledMessage={autoUpdateDisabledMessage}
                        value={form.watch("newDashboardEnableAutoUpdates")}
                        setValue={(checked) =>
                          form.setValue(
                            "newDashboardEnableAutoUpdates",
                            checked,
                          )
                        }
                      />
                    )}
                    <SelectField
                      label="View access"
                      options={[
                        { label: "Organization members", value: "published" },
                        {
                          label: "Only me",
                          value: "private",
                        },
                      ]}
                      value={form.watch("newDashboardShareLevel")}
                      onChange={(value) => {
                        form.setValue(
                          "newDashboardShareLevel",
                          value as DashboardShareLevel,
                        );
                        if (value === "private") {
                          form.setValue("newDashboardEditLevel", "private");
                        }
                      }}
                    />
                    <SelectField
                      label="Edit access"
                      disabled={
                        form.watch("newDashboardShareLevel") === "private"
                      }
                      options={[
                        {
                          label:
                            "Any organization members with editing permission",
                          value: "published",
                        },
                        {
                          label: "Only me",
                          value: "private",
                        },
                      ]}
                      value={form.watch("newDashboardEditLevel")}
                      onChange={(value) =>
                        form.setValue(
                          "newDashboardEditLevel",
                          value as DashboardEditLevel,
                        )
                      }
                    />
                  </Flex>
                </Box>
              )}

              <Box mt="4">
                <Field
                  label="Dashboard Block Name"
                  {...form.register("blockName")}
                  placeholder={defaultBlockName}
                  labelClassName="font-weight-bold"
                  containerClassName="mb-0"
                />
              </Box>

              <Box mt="4">
                <Box mb="2">
                  <Text weight="bold" size="2">
                    Block Type
                  </Text>
                </Box>
                {dimension ? (
                  <Text>Dimension Results</Text>
                ) : (
                  <RadioGroup
                    gap="0"
                    value={blockType}
                    setValue={(value) =>
                      form.setValue(
                        "blockType",
                        value as
                          | "experiment-metric"
                          | "experiment-time-series"
                          | "experiment-dimension",
                      )
                    }
                    options={[
                      { value: "experiment-metric", label: "Metric Results" },
                      {
                        value: "experiment-time-series",
                        label: "Timeseries Results",
                      },
                    ]}
                  />
                )}
              </Box>

              {hasMatchingBlock && (
                <Callout status="wizard" mt="3">
                  This dashboard already contains a similar block
                </Callout>
              )}
            </Box>

            <Box>
              <Heading size="2" weight="bold" mb="2">
                Summary
              </Heading>

              <Flex direction="column" gap="1">
                <Metadata label="Unit Dimension" value={dimensionName} />
                {sliceTagsCount > 0 && (
                  <Metadata label="Slices" value={String(sliceTagsCount)} />
                )}
                {metricsCount > 0 && (
                  <Metadata label="Metrics" value={String(metricsCount)} />
                )}
                {metricTagCount > 0 && (
                  <Metadata
                    label="Metric Tags"
                    value={String(metricTagCount)}
                  />
                )}
                {baselineText && (
                  <Metadata label="Baseline" value={baselineText} />
                )}
                <Metadata label="Variations" value={variationsText} />
                <Metadata
                  label="Difference Type"
                  value={differenceTypeDisplay}
                />
                <Metadata
                  label="Sort by"
                  value={
                    (sortBy === "significance" || sortBy === "change") &&
                    sortDirection
                      ? `${sortByDisplay} (${sortDirectionDisplay})`
                      : sortByDisplay
                  }
                />
              </Flex>
            </Box>
          </>
        )}
      </Modal>
    </>
  );
}
