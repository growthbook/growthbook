import React, { useMemo, useState, useEffect } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DifferenceType } from "shared/types/stats";
import {
  DashboardInterface,
  getBlockData,
  CREATE_BLOCK_TYPE,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  blockHasFieldOfType,
} from "shared/enterprise";
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
import {
  DashboardEditLevel,
  DashboardShareLevel,
} from "shared/enterprise";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import LinkButton from "@/ui/LinkButton";
import { PiArrowSquareOut } from "react-icons/pi";

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

// Utility function to compare arrays order-agnostically
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

// Utility function to check if two blocks have nearly matching configuration
function blocksNearlyMatch(
  block1: BlockComparisonFields,
  block2: BlockComparisonFields,
): boolean {
  // Must be the same block type
  if (block1.type !== block2.type) return false;

  // For dimension blocks, check dimensionId
  const hasDimension1 = blockHasFieldOfType(
    block1 as DashboardBlockInterfaceOrData<DashboardBlockInterface>,
    "dimensionId",
    (v): v is string => typeof v === "string",
  );
  const hasDimension2 = blockHasFieldOfType(
    block2 as DashboardBlockInterfaceOrData<DashboardBlockInterface>,
    "dimensionId",
    (v): v is string => typeof v === "string",
  );
  if (hasDimension1 && hasDimension2) {
    if (block1.dimensionId !== block2.dimensionId) return false;
  } else if (hasDimension1 !== hasDimension2) {
    return false;
  }

  // Compare filter arrays (order-agnostic)
  const sliceTags1 = block1.sliceTagsFilter || [];
  const sliceTags2 = block2.sliceTagsFilter || [];
  if (!arraysEqual(sliceTags1, sliceTags2)) return false;

  const metricIds1 = block1.metricIds || [];
  const metricIds2 = block2.metricIds || [];
  if (!arraysEqual(metricIds1, metricIds2)) return false;

  const metricTag1 = block1.metricTagFilter || [];
  const metricTag2 = block2.metricTagFilter || [];
  if (!arraysEqual(metricTag1, metricTag2)) return false;

  const variationIds1 = block1.variationIds || [];
  const variationIds2 = block2.variationIds || [];
  if (!arraysEqual(variationIds1, variationIds2)) return false;

  // Compare other fields
  const differenceType1 = block1.differenceType;
  const differenceType2 = block2.differenceType;
  if (differenceType1 !== differenceType2) return false;

  const sortBy1 = block1.sortBy;
  const sortBy2 = block2.sortBy;
  if (sortBy1 !== sortBy2) return false;

  const sortDirection1 = block1.sortDirection;
  const sortDirection2 = block2.sortDirection;
  if (sortDirection1 !== sortDirection2) return false;

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
  const { userId, hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();

  const {
    dashboards,
    loading: loadingDashboards,
    mutateDashboards,
  } = useExperimentDashboards(experiment.id);

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

  const [dashboardId, setDashboardId] = useState<string>("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [blockType, setBlockType] = useState<
    "experiment-metric" | "experiment-time-series" | "experiment-dimension"
  >(dimension ? "experiment-dimension" : "experiment-metric");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedDashboardId, setSavedDashboardId] = useState<string | null>(null);
  const [wasCreatingNew, setWasCreatingNew] = useState(false);

  // Dashboard creation fields
  const [newDashboardTitle, setNewDashboardTitle] = useState("");
  const [newDashboardShareLevel, setNewDashboardShareLevel] =
    useState<DashboardShareLevel>("published");
  const [newDashboardEditLevel, setNewDashboardEditLevel] =
    useState<DashboardEditLevel>("private");
  const [newDashboardEnableAutoUpdates, setNewDashboardEnableAutoUpdates] =
    useState(false);

  const canCreate = permissionsUtil.canCreateReport(experiment);

  // Initialize dashboardId with default or first available
  useEffect(() => {
    if (!dashboardId && filteredDashboards.length > 0) {
      setDashboardId(defaultDashboard?.id ?? filteredDashboards[0].id);
    }
  }, [dashboardId, filteredDashboards, defaultDashboard]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setIsCreatingNew(false);
      setNewDashboardTitle("");
      setNewDashboardShareLevel("published");
      setNewDashboardEditLevel("private");
      setNewDashboardEnableAutoUpdates(false);
      setSavedDashboardId(null);
      setWasCreatingNew(false);
    }
  }, [open]);

  const handleCreateNew = () => {
    if (!hasCommercialFeature("dashboards")) {
      setShowUpgradeModal(true);
      return;
    }
    if (canCreate) {
      setIsCreatingNew(true);
      setDashboardId("__create__");
    }
  };

  const handleDashboardSelect = (value: string) => {
    if (value === "__create__") {
      handleCreateNew();
    } else {
      setIsCreatingNew(false);
      setDashboardId(value);
    }
  };

  const dimensionName = dimension
    ? getDimensionById(dimension)?.name ||
      dimension?.split(":")?.[1] ||
      dimension
    : "None";

  // Generate default block name based on block type
  const defaultBlockName = useMemo(() => {
    if (blockType === "experiment-dimension") {
      return dimensionName !== "None"
        ? `Dimension Results: ${dimensionName}`
        : "Dimension Results";
    }
    if (blockType === "experiment-time-series") {
      return "Timeseries Results";
    }
    return "Metric Results";
  }, [blockType, dimensionName]);

  const [blockName, setBlockName] = useState(defaultBlockName);

  // Update block name when block type or dimension changes
  useEffect(() => {
    setBlockName(defaultBlockName);
  }, [defaultBlockName]);

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
    if (sortBy === "metricIds") return "Metric filter";
    if (sortBy === "significance") return "Significance";
    if (sortBy === "change") return "Change";
    if (sortBy === "custom") return "Metric order";
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

    // Map sortBy: "custom" -> "metricIds"
    const mappedSortBy: "metricIds" | "significance" | "change" | null =
      sortBy === "custom"
        ? "metricIds"
        : sortBy === "significance" || sortBy === "change"
          ? (sortBy as "significance" | "change")
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
    if (isCreatingNew && !newDashboardTitle.trim()) {
      setError("Dashboard name is required");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      // Map sortBy: "custom" -> "metricIds"
      const mappedSortBy: "metricIds" | "significance" | "change" | null =
        sortBy === "custom"
          ? "metricIds"
          : sortBy === "significance" || sortBy === "change"
            ? (sortBy as "significance" | "change")
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
        res = await apiCall<{
          status: number;
          dashboard: DashboardInterface;
        }>(`/dashboards`, {
          method: "POST",
          body: JSON.stringify({
            title: newDashboardTitle,
            shareLevel: newDashboardShareLevel,
            editLevel: newDashboardEditLevel,
            enableAutoUpdates: newDashboardEnableAutoUpdates,
            experimentId: experiment.id,
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
              href={`/${experiment.type === "multi-armed-bandit" ? "bandit" : "experiment"}/${experiment.id}#dashboards/${savedDashboardId}`}
              external={true}
              variant="outline"
            >
              View Dashboard{" "}
              <PiArrowSquareOut />
            </LinkButton>
          ) : undefined
        }
        ctaEnabled={
          savedDashboardId
            ? false
            : Boolean(
                isCreatingNew
                  ? newDashboardTitle.trim()
                  : dashboardId && dashboardId !== "__create__" && dashboardId !== "",
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
                ? "Your new dashboard has been created. Close this window to return to the experiment results."
                : "The results view has been added to the dashboard. Close this window to return to the experiment results."}
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
                  disabled={loadingDashboards || filteredDashboards.length === 0}
                />
              </Box>

              {isCreatingNew && (
                <Box className="bg-highlight rounded" mt="4" p="3">
                  <Text weight="bold" size="2" mb="3" style={{ display: "block" }}>
                    New Dashboard Settings
                  </Text>
                  <Flex direction="column" gap="3">
                    <Field
                      label="Dashboard Name"
                      value={newDashboardTitle}
                      onChange={(e) => setNewDashboardTitle(e.target.value)}
                      placeholder="Enter dashboard name"
                      labelClassName="font-weight-bold"
                      containerClassName="mb-0"
                    />
                    <SelectField
                      label="View access"
                      options={[
                        { label: "Organization members", value: "published" },
                        {
                          label: "Only me",
                          value: "private",
                        },
                      ]}
                      value={newDashboardShareLevel}
                      onChange={(value) => {
                        setNewDashboardShareLevel(value as DashboardShareLevel);
                        if (value === "private") {
                          setNewDashboardEditLevel("private");
                        }
                      }}
                      labelClassName="font-weight-bold"
                      containerClassName="mb-0"
                    />
                    <SelectField
                      label="Edit access"
                      disabled={newDashboardShareLevel === "private"}
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
                      value={newDashboardEditLevel}
                      onChange={(value) =>
                        setNewDashboardEditLevel(value as DashboardEditLevel)
                      }
                      labelClassName="font-weight-bold"
                      containerClassName="mb-0"
                    />
                    <Checkbox
                      label="Auto-update dashboard data"
                      value={newDashboardEnableAutoUpdates}
                      setValue={setNewDashboardEnableAutoUpdates}
                      weight="regular"
                    />
                  </Flex>
                </Box>
              )}

              <Box mt="4">
                <Field
                  label="Dashboard Block Name"
                  value={blockName}
                  onChange={(e) => setBlockName(e.target.value)}
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
                      setBlockType(
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
                  <Metadata label="Metric Tags" value={String(metricTagCount)} />
                )}
                {baselineText && <Metadata label="Baseline" value={baselineText} />}
                <Metadata label="Variations" value={variationsText} />
                <Metadata label="Difference Type" value={differenceTypeDisplay} />
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
