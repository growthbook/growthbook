import React, { useMemo, useCallback } from "react";
import { Flex, Box, Heading } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { FactTableColumnType } from "shared/types/fact-table";
import { parseSliceQueryString, isMetricGroupId } from "shared/experiments";
import clsx from "clsx";
import { FormatOptionLabelMeta } from "react-select";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { SingleValue } from "@/components/Forms/SelectField";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import HelperText from "@/ui/HelperText";
import { useUser } from "@/services/UserContext";
import MetricName from "@/components/Metrics/MetricName";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function ResultsMetricFilter({
  availableMetricTags = [],
  metricTagFilter = [],
  setMetricTagFilter,
  availableMetricsFilters = { groups: [], metrics: [] },
  metricsFilter = [],
  setMetricsFilter,
  availableSliceTags = [],
  sliceTagsFilter = [],
  setSliceTagsFilter,
  showMetricFilter,
  setShowMetricFilter,
  dimension,
}: {
  availableMetricTags?: string[];
  metricTagFilter?: string[];
  setMetricTagFilter?: (tags: string[]) => void;
  availableMetricsFilters?: {
    groups: Array<{ id: string; name: string }>;
    metrics: Array<{ id: string; name: string }>;
  };
  metricsFilter?: string[];
  setMetricsFilter?: (filters: string[]) => void;
  availableSliceTags?: Array<{
    id: string;
    datatypes: Record<string, FactTableColumnType>;
    isSelectAll?: boolean;
  }>;
  sliceTagsFilter?: string[];
  setSliceTagsFilter?: (tags: string[]) => void;
  showMetricFilter: boolean;
  setShowMetricFilter: (show: boolean) => void;
  dimension?: string;
}) {
  const { hasCommercialFeature } = useUser();
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");
  const hasMetricGroupsFeature = hasCommercialFeature("metric-groups");
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();

  const filteringApplied =
    metricTagFilter?.length > 0 ||
    metricsFilter?.length > 0 ||
    sliceTagsFilter?.length > 0;

  const activeFilterCount =
    (metricTagFilter?.length || 0) +
    (metricsFilter?.length || 0) +
    (sliceTagsFilter?.length || 0);

  type SliceChunk = {
    column: string;
    value: string | null;
    datatype: FactTableColumnType;
    isOther: boolean;
    isSelectAll?: boolean;
  };

  const sliceOptions = useMemo(() => {
    return availableSliceTags.map((tag) => {
      // Handle "select all" format: dim:column (no equals sign)
      if (tag.isSelectAll || !tag.id.includes("=")) {
        // Extract column name from dim:column format
        const columnMatch = tag.id.match(/^dim:(.+)$/);
        if (columnMatch) {
          const column = decodeURIComponent(columnMatch[1]);
          const datatype = tag.datatypes[column] || "string";
          return {
            value: tag.id,
            parsedChunks: [
              {
                column,
                value: null,
                datatype,
                isSelectAll: true,
                isOther: false,
              },
            ],
          };
        }
      }

      // Parse regular slice tag using parseSliceQueryString
      const sliceLevels = parseSliceQueryString(tag.id);
      const parsedChunks: SliceChunk[] = sliceLevels.map((sl) => {
        const value = sl?.levels?.[0] || "";
        const datatype = tag?.datatypes?.[sl?.column] || "string";

        return {
          column: sl.column,
          value: value || null,
          datatype,
          isOther: !value,
        };
      });

      return {
        value: tag.id,
        parsedChunks,
      };
    });
  }, [availableSliceTags]);

  const formatSliceOptionLabel = useCallback(
    (
      option: { value: string; parsedChunks: SliceChunk[] },
      meta: FormatOptionLabelMeta<SingleValue>,
    ) => {
      // Select all options always have exactly one chunk with isSelectAll=true
      if (option.parsedChunks[0]?.isSelectAll) {
        const chunk = option.parsedChunks[0];
        return (
          <span>
            {chunk.column} <span className="text-muted">(All Slices)</span>
          </span>
        );
      }

      // Regular slices: all chunks are non-select-all
      return (
        <span className={clsx(meta?.context === "menu" && "pl-3")}>
          {option.parsedChunks.map((chunk, index) => (
            <React.Fragment key={index}>
              {index > 0 && ", "}
              {chunk.isOther ? (
                <>
                  {chunk.column}:{" "}
                  <span
                    style={{
                      fontVariant: "small-caps",
                      fontWeight: 600,
                    }}
                  >
                    {chunk.datatype === "boolean" ? "null" : "other"}
                  </span>
                </>
              ) : (
                `${chunk.column}: ${chunk.value}`
              )}
            </React.Fragment>
          ))}
        </span>
      );
    },
    [],
  );

  return (
    <Flex align="center" gap="3" className="position-relative">
      <Popover
        side="top"
        align="start"
        open={showMetricFilter}
        onOpenChange={setShowMetricFilter}
        triggerAsChild={true}
        trigger={
          <Button color="violet" variant="ghost" size="sm" icon={<PiPlus />}>
            <Flex align="center" gap="1">
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <Badge
                  color="indigo"
                  variant="solid"
                  radius="full"
                  label={String(activeFilterCount)}
                  style={{ minWidth: 18, height: 18 }}
                />
              )}
            </Flex>
          </Button>
        }
        content={
          <Flex direction="column" justify="between" style={{ width: 550 }}>
            <Box>
              <Flex align="center" justify="between" mb="2">
                <Heading size="2" weight="medium">
                  <Flex align="center" gap="1">
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge
                        color="indigo"
                        variant="solid"
                        radius="full"
                        label={String(activeFilterCount)}
                        style={{ minWidth: 18, height: 18 }}
                      />
                    )}
                  </Flex>
                </Heading>
                {filteringApplied ? (
                  <Link
                    color="red"
                    className="font-weight-bold position-relative"
                    style={{ top: -4 }}
                    onClick={async () => {
                      setMetricTagFilter?.([]);
                      setMetricsFilter?.([]);
                      setSliceTagsFilter?.([]);
                    }}
                  >
                    Clear all
                  </Link>
                ) : null}
              </Flex>
              {availableSliceTags.length > 0 && hasMetricSlicesFeature && (
                <Flex
                  gap="2"
                  p="3"
                  mb="2"
                  align="center"
                  className="bg-highlight rounded"
                >
                  <Box style={{ width: 80 }}>
                    <Heading size="2" weight="medium" mb="0">
                      {dimension && (sliceTagsFilter?.length || 0) > 0 ? (
                        <Tooltip body="Slice filters are ignored when a unit dimension is set">
                          <HelperText status="warning">Slices</HelperText>
                        </Tooltip>
                      ) : (
                        "Slices"
                      )}
                    </Heading>
                  </Box>
                  <MultiSelectField
                    customClassName="multiselect-unfixed"
                    containerClassName="w-100"
                    placeholder="Type to search..."
                    value={sliceTagsFilter || []}
                    options={sliceOptions.map(({ value }) => ({
                      label: value,
                      value,
                    }))}
                    formatOptionLabel={(option, meta) => {
                      const fullOption = sliceOptions.find(
                        (o) => o.value === option.value,
                      );
                      if (!fullOption || !fullOption.parsedChunks) {
                        return option.label;
                      }
                      return formatSliceOptionLabel(fullOption, meta);
                    }}
                    onChange={(v) => {
                      setSliceTagsFilter?.(v);
                      return;
                    }}
                    sort={false}
                  />
                </Flex>
              )}
              {(availableMetricsFilters.groups.length > 0 ||
                availableMetricsFilters.metrics.length > 0) && (
                <Flex
                  gap="2"
                  p="3"
                  mb="2"
                  align="center"
                  className="bg-highlight rounded"
                >
                  <Heading
                    size="2"
                    weight="medium"
                    mb="0"
                    style={{ width: 80 }}
                  >
                    Metrics
                  </Heading>
                  <MultiSelectField
                    customClassName="multiselect-unfixed"
                    containerClassName="w-100"
                    placeholder="Type to search..."
                    value={metricsFilter || []}
                    options={[
                      ...(hasMetricGroupsFeature &&
                      availableMetricsFilters.groups.length > 0
                        ? [
                            {
                              label: "Metric Groups",
                              options: availableMetricsFilters.groups.map(
                                (group) => ({
                                  label: group.name,
                                  value: group.id,
                                }),
                              ),
                            },
                          ]
                        : []),
                      ...(availableMetricsFilters.metrics.length > 0
                        ? [
                            {
                              label: "Metrics",
                              options: availableMetricsFilters.metrics.map(
                                (metric) => ({
                                  label: metric.name,
                                  value: metric.id,
                                }),
                              ),
                            },
                          ]
                        : []),
                    ]}
                    formatOptionLabel={(option) => {
                      const isGroup = isMetricGroupId(option.value);
                      const metrics = isGroup
                        ? (() => {
                            const group = getMetricGroupById(option.value);
                            if (!group) return undefined;
                            return group.metrics.map((metricId) => {
                              const metric = getExperimentMetricById(metricId);
                              return { metric, joinable: true };
                            });
                          })()
                        : undefined;
                      return (
                        <MetricName
                          id={option.value}
                          showDescription={false}
                          isGroup={isGroup}
                          metrics={metrics}
                          officialBadgePosition="left"
                        />
                      );
                    }}
                    formatGroupLabel={(group) => (
                      <div className="pb-1 pt-2">{group.label}</div>
                    )}
                    onChange={(v) => {
                      setMetricsFilter?.(v);
                      return;
                    }}
                    sort={false}
                  />
                </Flex>
              )}
              {availableMetricTags.length > 0 && (
                <Flex
                  gap="2"
                  p="3"
                  mb="2"
                  align="center"
                  className="bg-highlight rounded"
                >
                  <Heading
                    size="2"
                    weight="medium"
                    mb="0"
                    style={{ width: 80 }}
                  >
                    Tags
                  </Heading>
                  <MultiSelectField
                    customClassName="multiselect-unfixed"
                    containerClassName="w-100"
                    placeholder="Type to search..."
                    value={metricTagFilter || []}
                    options={availableMetricTags.map((tag) => ({
                      label: tag,
                      value: tag,
                    }))}
                    onChange={(v) => {
                      setMetricTagFilter?.(v);
                      return;
                    }}
                  />
                </Flex>
              )}
            </Box>
          </Flex>
        }
      />

      {filteringApplied ? (
        <Link
          color="red"
          className="font-weight-bold"
          onClick={async () => {
            setMetricTagFilter?.([]);
            setMetricsFilter?.([]);
            setSliceTagsFilter?.([]);
          }}
        >
          Clear
        </Link>
      ) : null}
    </Flex>
  );
}
