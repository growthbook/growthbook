import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DifferenceType } from "shared/types/stats";
import {
  DashboardInterface,
  getBlockData,
  CREATE_BLOCK_TYPE,
  DashboardEditLevel,
  DashboardShareLevel,
} from "shared/enterprise";
import { PiCaretRight, PiArrowSquareOut } from "react-icons/pi";
import cronstrue from "cronstrue";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperimentDashboards } from "@/hooks/useDashboards";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { getExperimentRefreshFrequency } from "@/services/env";
import LinkButton from "@/ui/LinkButton";
import {
  SelectDashboardAndBlockPage,
  NewDashboardSettingsPage,
  ConfirmationPage,
} from "./MigrateResultsToDashboardModalPages";

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
  const [step, setStep] = useState(0);

  const savedDashboardName = savedDashboardId
    ? dashboards.find((d) => d.id === savedDashboardId)?.title
    : null;
  const canCreate = permissionsUtil.canCreateReport(experiment);

  const dashboardId = form.watch("dashboardId");
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

  // Reset form and step when modal closes
  useEffect(() => {
    if (!open) {
      setError(null);
      setSavedDashboardId(null);
      setWasCreatingNew(false);
      setStep(0);
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

  // Check if the new block would match an existing block in the selected dashboard
  const hasMatchingBlock = useMemo(() => {
    if (!dashboardId) return false;

    const selectedDashboard = dashboards.find((d) => d.id === dashboardId);
    if (!selectedDashboard || !selectedDashboard.blocks) return false;

    // Map sortBy: "metrics" and "metricTags" are used consistently in both experiment results and dashboards
    const mappedSortBy:
      | "metrics"
      | "metricTags"
      | "significance"
      | "change"
      | null =
      sortBy === "metrics" ||
      sortBy === "metricTags" ||
      sortBy === "significance" ||
      sortBy === "change"
        ? (sortBy as "metrics" | "metricTags" | "significance" | "change")
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

    // Validate based on current step
    if (step === 0) {
      // Page 1: Validate dashboard selection
      if (!isCreatingNew && !dashboardId) {
        setError("Please select a dashboard");
        return;
      }
      if (isCreatingNew) {
        // For new dashboard, advance to page 2
        setStep(1);
        return;
      }
      // For existing dashboard, proceed with submission
    } else if (step === 1) {
      // Page 2 (new dashboard only): Validate dashboard name
      if (!form.watch("newDashboardTitle").trim()) {
        setError("Dashboard name is required");
        return;
      }
      // Proceed with submission
    } else {
      // Already on confirmation page
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      // Map sortBy: "metrics" and "metricTags" are used consistently in both experiment results and dashboards
      const mappedSortBy:
        | "metrics"
        | "metricTags"
        | "significance"
        | "change"
        | null =
        sortBy === "metrics" ||
        sortBy === "metricTags" ||
        sortBy === "significance" ||
        sortBy === "change"
          ? (sortBy as "metrics" | "metricTags" | "significance" | "change")
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
        setError(null);
        // Advance to confirmation page
        // For existing dashboard: step 0 -> step 1 (confirmation)
        // For new dashboard: step 1 -> step 2 (confirmation)
        setStep(isCreatingNew ? 2 : 1);
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

  // Determine which pages to show based on flow
  const isCreatingNew = form.watch("isCreatingNew");
  const confirmationStep = isCreatingNew ? 2 : 1;
  const canGoBack = step < confirmationStep && !savedDashboardId;

  // Calculate CTA text and enabled state
  const getCtaText = () => {
    if (savedDashboardId) return undefined;
    if (step === 0 && isCreatingNew) return undefined; // Will show "Next"
    if (step === confirmationStep) return undefined; // Confirmation page
    return (
      <>
        Save & Continue{" "}
        <PiCaretRight className="position-relative" style={{ top: -1 }} />
      </>
    );
  };

  const getCtaEnabled = () => {
    if (savedDashboardId) return false;
    if (step === confirmationStep) return false;
    if (step === 0) {
      if (isCreatingNew) {
        // Can proceed to next page if dashboard is selected
        return dashboardId === "__create__";
      } else {
        // Can save if dashboard is selected
        return Boolean(
          dashboardId && dashboardId !== "__create__" && dashboardId !== "",
        );
      }
    }
    if (step === 1) {
      // New dashboard settings page
      return Boolean(form.watch("newDashboardTitle").trim());
    }
    return false;
  };

  // Get secondary CTA (View Dashboard link when saved)
  const getSecondaryCTA = () => {
    if (!savedDashboardId) return undefined;
    return (
      <LinkButton
        href={`/${isBandit ? "bandit" : "experiment"}/${experiment.id}#dashboards/${savedDashboardId}`}
        external={true}
      >
        View Dashboard <PiArrowSquareOut />
      </LinkButton>
    );
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
      {open && (
        <PagedModal
          header={
            savedDashboardId
              ? `Block added to "${savedDashboardName}"`
              : "Add Results View to Dashboard"
          }
          subHeader={
            savedDashboardId
              ? undefined
              : "Capture the current settings of this Experiment Results view to use in a Dashboard"
          }
          close={close}
          submit={savedDashboardId ? undefined : handleSubmit}
          cta={getCtaText()}
          ctaEnabled={getCtaEnabled() && !isSubmitting}
          loading={isSubmitting}
          size="lg"
          step={step}
          setStep={setStep}
          backButton={canGoBack}
          closeCta={savedDashboardId ? "Close" : "Cancel"}
          hideNav={true}
          autoCloseOnSubmit={false}
          secondaryCTA={getSecondaryCTA()}
          trackingEventModalType="migrate-results-to-dashboard"
          trackingEventModalSource="experiment-results"
        >
          <Page display="Select Dashboard & Block">
            <SelectDashboardAndBlockPage
              experiment={experiment}
              dimension={dimension}
              dimensionName={dimensionName}
              metricTagFilter={metricTagFilter}
              metricsFilter={metricsFilter}
              sliceTagsFilter={sliceTagsFilter}
              baselineRow={baselineRow}
              variationFilter={variationFilter}
              sortBy={sortBy}
              sortDirection={sortDirection}
              differenceType={differenceType}
              form={form}
              defaultBlockName={defaultBlockName}
              hasMatchingBlock={hasMatchingBlock}
              filteredDashboards={filteredDashboards}
              defaultDashboard={defaultDashboard}
              loadingDashboards={loadingDashboards}
              canCreate={canCreate}
              onDashboardSelect={handleDashboardSelect}
              onCreateNew={handleCreateNew}
              error={error}
            />
          </Page>

          {isCreatingNew && (
            <Page
              display="Dashboard Settings"
              enabled={isCreatingNew}
              validate={async () => {
                if (!form.watch("newDashboardTitle").trim()) {
                  throw new Error("Dashboard name is required");
                }
              }}
            >
              <NewDashboardSettingsPage
                form={form}
                refreshInterval={refreshInterval}
                updateSchedule={updateSchedule}
              />
            </Page>
          )}

          <Page display="Confirmation" enabled={!!savedDashboardId}>
            {savedDashboardId ? (
              <ConfirmationPage
                wasCreatingNew={wasCreatingNew}
                blockType={blockType}
              />
            ) : (
              <div />
            )}
          </Page>
        </PagedModal>
      )}
    </>
  );
}
