import React, { useMemo, useEffect } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { UseFormReturn } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DifferenceType } from "shared/types/stats";
import {
  DashboardInterface,
  DashboardEditLevel,
  DashboardShareLevel,
} from "shared/enterprise";
import {
  parseSliceQueryString,
  isSliceTagSelectAll,
  isMetricGroupId,
  getLatestPhaseVariations,
} from "shared/experiments";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Metadata from "@/ui/Metadata";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import DashboardSelector from "@/enterprise/components/Dashboards/DashboardSelector";
import { autoUpdateDisabledMessage } from "@/enterprise/components/Dashboards/DashboardsTab";
import Link from "@/ui/Link";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";

type FormValues = {
  dashboardId: string;
  blockType: "experiment-metric" | "experiment-dimension";
  blockName: string;
  newDashboardTitle: string;
  newDashboardShareLevel: DashboardShareLevel;
  newDashboardEditLevel: DashboardEditLevel;
  newDashboardEnableAutoUpdates: boolean;
};

type SharedProps = {
  experiment: ExperimentInterfaceStringDates;
  dimension?: string;
  dimensionName: string;
  metricTagFilter?: string[];
  metricsFilter?: string[];
  sliceTagsFilter?: string[];
  baselineRow?: number;
  variationFilter?: number[];
  sortBy?: string | null;
  sortDirection?: string | null;
  differenceType?: DifferenceType;
  form: UseFormReturn<FormValues>;
  defaultBlockName: string;
  hasMatchingBlock: boolean;
  filteredDashboards: DashboardInterface[];
  defaultDashboard?: DashboardInterface;
  loadingDashboards: boolean;
  canCreate: boolean;
  onDashboardSelect: (value: string) => void;
  onCreateNew: () => void;
  error: string | null;
  refreshInterval?: string;
  updateSchedule?: { type: string };
  defaultFormValues: FormValues;
};

export function SelectDashboardAndBlockPage({
  experiment,
  dimension,
  dimensionName,
  metricTagFilter = [],
  metricsFilter = [],
  sliceTagsFilter = [],
  baselineRow,
  variationFilter,
  sortBy,
  sortDirection,
  differenceType,
  form,
  defaultBlockName,
  hasMatchingBlock,
  filteredDashboards,
  defaultDashboard,
  loadingDashboards,
  canCreate,
  onDashboardSelect,
  onCreateNew,
  error,
  refreshInterval,
  updateSchedule,
  defaultFormValues,
}: SharedProps) {
  const dashboardId = form.watch("dashboardId");
  const isCreatingNew = dashboardId === "__create__";

  // Auto-focus the dashboard name field when creating a new dashboard
  useEffect(() => {
    if (isCreatingNew) {
      // Small delay to ensure the field is rendered
      setTimeout(() => {
        const input = document.getElementById("dashboard-name-input");
        if (input instanceof HTMLInputElement) {
          input.focus();
        }
      }, 0);
    }
  }, [isCreatingNew]);

  const metricTagCount = metricTagFilter?.length || 0;
  const metricsCount = metricsFilter?.length || 0;
  const sliceTagsCount = sliceTagsFilter?.length || 0;

  const variations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  const baselineText = useMemo(() => {
    if (baselineRow === undefined || !variations[baselineRow]) {
      return null;
    }
    const variation = variations[baselineRow];
    return `${baselineRow} - ${variation.name}`;
  }, [baselineRow, variations]);

  const variationsText = useMemo(() => {
    const baselineIndex = baselineRow ?? 0;
    const visibleIndices = variations
      .map((_, index) => index)
      .filter(
        (index) =>
          index !== baselineIndex &&
          (!variationFilter || !variationFilter.includes(index)),
      );
    const totalVariations = variations.length - 1;

    if (
      visibleIndices.length === 0 ||
      visibleIndices.length === totalVariations
    ) {
      return "All variations";
    }
    return visibleIndices.map((index) => `#${index}`).join(", ");
  }, [variationFilter, variations, baselineRow]);

  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();

  const sliceTagsDisplay = useMemo(() => {
    return sliceTagsFilter
      .map((tag) => {
        // Check if it's a "select all" tag
        const selectAllResult = isSliceTagSelectAll(tag);
        if (selectAllResult.isSelectAll && selectAllResult.column) {
          return `${selectAllResult.column}: All`;
        }
        // Parse regular slice tag (e.g., "dim:browser=Chrome&dim:country=AU")
        const sliceLevels = parseSliceQueryString(tag);
        if (sliceLevels.length === 0) {
          return tag; // Fallback to original if parsing fails
        }
        return sliceLevels
          .map((level) => {
            const value = level.levels[0] || "other";
            return `${level.column}=${value}`;
          })
          .join(" + ");
      })
      .join(", ");
  }, [sliceTagsFilter]);

  const metricsDisplay = useMemo(() => {
    return metricsFilter
      .map((metricId) => {
        if (isMetricGroupId(metricId)) {
          const group = getMetricGroupById(metricId);
          return group ? group.name : metricId;
        }
        const metric = getExperimentMetricById(metricId);
        return metric ? metric.name : metricId;
      })
      .join(", ");
  }, [metricsFilter, getExperimentMetricById, getMetricGroupById]);
  const metricFiltersTagsDisplay = useMemo(() => {
    // commma-separated list of metric tags
    return metricTagFilter.join(", ");
  }, [metricTagFilter]);

  const sortByDisplay = useMemo(() => {
    if (sortBy === "metrics") return "Metric order";
    if (sortBy === "metricTags") return "Metric tags";
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

  return (
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
            setValue={onDashboardSelect}
            canCreate={canCreate}
            onCreateNew={onCreateNew}
            showIcon={false}
            disabled={loadingDashboards}
          />
        </Box>

        {isCreatingNew && (
          <>
            <Box mt="4">
              <Field
                id="dashboard-name-input"
                label="Dashboard Name"
                {...form.register("newDashboardTitle")}
                placeholder="Dashboard name"
                labelClassName="font-weight-bold"
                containerClassName="mb-0"
                onFocus={(e) => {
                  if (e.target.value === defaultFormValues.newDashboardTitle) {
                    e.target.select();
                  }
                }}
              />
            </Box>

            <Box mt="4">
              <Collapsible
                trigger={
                  <Link className="font-weight-bold">
                    <Text>
                      <PiCaretRightFill className="chevron mr-1" />
                      Dashboard Settings
                    </Text>
                  </Link>
                }
                open={false}
                transitionTime={100}
              >
                <Box className="bg-highlight rounded p-3" mt="3">
                  <Flex direction="column" gap="5">
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
                      containerClassName="mb-0"
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
                      containerClassName="mb-0"
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
              </Collapsible>
            </Box>
          </>
        )}

        <Box mt="4">
          <Field
            label="Block Name"
            {...form.register("blockName")}
            placeholder={defaultBlockName}
            labelClassName="font-weight-bold"
            containerClassName="mb-0"
          />

          <Box mt="2">
            <Text size="2" mt="2" color="gray">
              <Flex align="center" display="inline-flex" gap="1">
                <span>Will be imported as </span>
                <Avatar radius="small" color="indigo" variant="soft" size="sm">
                  {dimension
                    ? BLOCK_TYPE_INFO["experiment-dimension"].icon
                    : BLOCK_TYPE_INFO["experiment-metric"].icon}
                </Avatar>

                <Text weight="bold" color="indigo">
                  {dimension ? "Dimension Results" : "Metric Results"}
                </Text>
                <span> block</span>
              </Flex>
            </Text>
          </Box>
        </Box>

        {hasMatchingBlock && (
          <Callout status="wizard" mt="3">
            This dashboard already contains a similar block. Click &quot;Save
            &amp; Continue&quot; to create this block anyhow.
          </Callout>
        )}
      </Box>

      <hr className="mb-4" />

      <Box>
        <Heading size="2" weight="bold" mb="3">
          View Summary
        </Heading>

        <Flex direction="column" gap="1">
          <Metadata label="Unit Dimension" value={dimensionName} />
          {sliceTagsCount > 0 || metricsCount > 0 || metricTagCount > 0 ? (
            <Box my="1">
              <Text>
                Filters{" "}
                <Badge
                  radius="full"
                  label={String(sliceTagsCount + metricsCount + metricTagCount)}
                />
              </Text>
              <Box ml="2" mb="1">
                {sliceTagsCount > 0 && (
                  <Metadata
                    label="Slices"
                    value={<Text size="1">{sliceTagsDisplay}</Text>}
                  />
                )}
                {metricsCount > 0 && (
                  <Metadata
                    label="Metrics"
                    value={<Text size="1">{metricsDisplay}</Text>}
                  />
                )}
                {metricTagCount > 0 && (
                  <Metadata
                    label="Metric Tags"
                    value={<Text size="1">{metricFiltersTagsDisplay}</Text>}
                  />
                )}
              </Box>
            </Box>
          ) : null}
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
  );
}

export function NewDashboardSettingsPage({
  form,
  refreshInterval,
  updateSchedule,
}: {
  form: UseFormReturn<FormValues>;
  refreshInterval?: string;
  updateSchedule?: { type: string };
}) {
  return (
    <>
      <Heading size="2" weight="bold" mb="3">
        New Dashboard Settings
      </Heading>
      <Flex direction="column" gap="5" mb="2">
        <Field
          label="Name"
          {...form.register("newDashboardTitle")}
          placeholder="Dashboard name"
          containerClassName="mb-0"
        />
        {refreshInterval && (
          <Checkbox
            label="Auto-update dashboard data"
            description={`An automatic data refresh will occur ${refreshInterval}.`}
            disabled={updateSchedule?.type === "never"}
            disabledMessage={autoUpdateDisabledMessage}
            value={form.watch("newDashboardEnableAutoUpdates")}
            setValue={(checked) =>
              form.setValue("newDashboardEnableAutoUpdates", checked)
            }
          />
        )}
        <SelectField
          label="View access"
          containerClassName="mb-0"
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
          containerClassName="mb-0"
          disabled={form.watch("newDashboardShareLevel") === "private"}
          options={[
            {
              label: "Any organization members with editing permission",
              value: "published",
            },
            {
              label: "Only me",
              value: "private",
            },
          ]}
          value={form.watch("newDashboardEditLevel")}
          onChange={(value) =>
            form.setValue("newDashboardEditLevel", value as DashboardEditLevel)
          }
        />
      </Flex>
    </>
  );
}

export function ConfirmationPage({
  isNewDashboard,
  blockType,
}: {
  isNewDashboard: boolean;
  blockType: "experiment-metric" | "experiment-dimension";
}) {
  const getBlockTypeDisplay = () => {
    if (blockType === "experiment-dimension") return "Dimension Results";
    return "Metric Results";
  };
  const blockTypeDisplay = getBlockTypeDisplay();

  return (
    <Box my="4">
      <Text>
        {isNewDashboard ? (
          <>
            Your new dashboard has been created, and the{" "}
            <strong>{blockTypeDisplay}</strong> block has been added to it.
          </>
        ) : (
          <>
            The new <strong>{blockTypeDisplay}</strong> block was appended to
            the bottom of your selected dashboard.
          </>
        )}
      </Text>
    </Box>
  );
}
