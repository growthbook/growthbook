import React from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { UseFormReturn } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DifferenceType } from "shared/types/stats";
import {
  DashboardInterface,
  DashboardEditLevel,
  DashboardShareLevel,
} from "shared/enterprise";
import Metadata from "@/ui/Metadata";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import DashboardSelector from "@/enterprise/components/Dashboards/DashboardSelector";
import { autoUpdateDisabledMessage } from "@/enterprise/components/Dashboards/DashboardsTab";

type FormValues = {
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
}: SharedProps) {
  const isCreatingNew = form.watch("isCreatingNew");
  const blockType = form.watch("blockType");
  const dashboardId = form.watch("dashboardId");

  const metricTagCount = metricTagFilter?.length || 0;
  const metricsCount = metricsFilter?.length || 0;
  const sliceTagsCount = sliceTagsFilter?.length || 0;

  const baselineText = React.useMemo(() => {
    if (baselineRow === undefined || !experiment.variations[baselineRow]) {
      return null;
    }
    const variation = experiment.variations[baselineRow];
    return `${baselineRow} - ${variation.name}`;
  }, [baselineRow, experiment.variations]);

  const variationsText = React.useMemo(() => {
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

  const sortByDisplay = React.useMemo(() => {
    if (sortBy === "metrics") return "Metric order";
    if (sortBy === "metricTags") return "Metric tags";
    if (sortBy === "significance") return "Significance";
    if (sortBy === "change") return "Change";
    return "Default";
  }, [sortBy]);

  const sortDirectionDisplay = React.useMemo(() => {
    if (sortDirection === "asc") return "Ascending";
    if (sortDirection === "desc") return "Descending";
    return "";
  }, [sortDirection]);

  const differenceTypeDisplay = React.useMemo(() => {
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
            disabled={loadingDashboards || filteredDashboards.length === 0}
          />
        </Box>

        <Box mt="4">
          <Field
            label="Block Name"
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

      <hr className="mb-4" />

      <Box>
        <Heading size="2" weight="bold" mb="3">
          View Summary
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
  wasCreatingNew,
  blockType,
}: {
  wasCreatingNew: boolean;
  blockType:
    | "experiment-metric"
    | "experiment-time-series"
    | "experiment-dimension";
}) {
  const getBlockTypeDisplay = () => {
    if (blockType === "experiment-time-series") return "Time Series";
    if (blockType === "experiment-dimension") return "Dimension Results";
    return "Metric Results";
  };

  const blockTypeDisplay = getBlockTypeDisplay();

  return (
    <Box my="4">
      <Text>
        {wasCreatingNew ? (
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
