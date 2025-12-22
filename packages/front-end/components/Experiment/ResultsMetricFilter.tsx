import React, { useMemo, useCallback } from "react";
import { Flex, Box, Heading } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { FactTableColumnType } from "shared/types/fact-table";
import { parseSliceQueryString } from "shared/experiments";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import HelperText from "@/ui/HelperText";

export default function ResultsMetricFilter({
  metricTags = [],
  metricTagFilter = [],
  setMetricTagFilter,
  availableMetricGroups = [],
  metricGroupsFilter = [],
  setMetricGroupsFilter,
  availableSliceTags = [],
  sliceTagsFilter = [],
  setSliceTagsFilter,
  showMetricFilter,
  setShowMetricFilter,
  dimension,
}: {
  metricTags?: string[];
  metricTagFilter?: string[];
  setMetricTagFilter?: (tags: string[]) => void;
  availableMetricGroups?: Array<{ id: string; name: string }>;
  metricGroupsFilter?: string[];
  setMetricGroupsFilter?: (groups: string[]) => void;
  availableSliceTags?: Array<{
    id: string;
    datatypes: Record<string, FactTableColumnType>;
  }>;
  sliceTagsFilter?: string[];
  setSliceTagsFilter?: (tags: string[]) => void;
  showMetricFilter: boolean;
  setShowMetricFilter: (show: boolean) => void;
  dimension?: string;
}) {
  const filteringApplied =
    metricTagFilter?.length > 0 ||
    metricGroupsFilter?.length > 0 ||
    sliceTagsFilter?.length > 0;

  const activeFilterCount =
    (metricTagFilter?.length || 0) +
    (metricGroupsFilter?.length || 0) +
    (sliceTagsFilter?.length || 0);

  type SliceChunk = {
    column: string;
    value: string | null;
    datatype: FactTableColumnType;
    isOther: boolean;
  };

  const sliceOptions = useMemo(() => {
    return availableSliceTags.map((tag) => {
      // Parse slice tag using parseSliceQueryString
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
    (option: { value: string; parsedChunks: SliceChunk[] }) => {
      return (
        <span>
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
                      setMetricGroupsFilter?.([]);
                      setSliceTagsFilter?.([]);
                    }}
                  >
                    Clear all
                  </Link>
                ) : null}
              </Flex>
              {availableSliceTags.length > 0 && (
                <Flex
                  gap="2"
                  p="3"
                  mb="2"
                  align="center"
                  className="bg-highlight rounded"
                >
                  <Box style={{ width: 150 }}>
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
                    formatOptionLabel={(option) => {
                      const fullOption = sliceOptions.find(
                        (o) => o.value === option.value,
                      );
                      if (!fullOption || !fullOption.parsedChunks) {
                        return option.label;
                      }
                      return formatSliceOptionLabel(fullOption);
                    }}
                    onChange={(v) => {
                      setSliceTagsFilter?.(v);
                      return;
                    }}
                    sort={false}
                  />
                </Flex>
              )}
              {availableMetricGroups.length > 0 && (
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
                    style={{ width: 150 }}
                  >
                    Metric groups
                  </Heading>
                  <MultiSelectField
                    customClassName="multiselect-unfixed"
                    containerClassName="w-100"
                    placeholder="Type to search..."
                    value={metricGroupsFilter || []}
                    options={availableMetricGroups.map((group) => ({
                      label: group.name,
                      value: group.id,
                    }))}
                    onChange={(v) => {
                      setMetricGroupsFilter?.(v);
                      return;
                    }}
                    sort={false}
                  />
                </Flex>
              )}
              <Flex
                gap="2"
                p="3"
                mb="2"
                align="center"
                className="bg-highlight rounded"
              >
                <Heading size="2" weight="medium" mb="0" style={{ width: 150 }}>
                  Tags
                </Heading>
                <MultiSelectField
                  customClassName="multiselect-unfixed"
                  containerClassName="w-100"
                  placeholder="Type to search..."
                  value={metricTagFilter || []}
                  options={metricTags.map((tag) => ({
                    label: tag,
                    value: tag,
                  }))}
                  onChange={(v) => {
                    setMetricTagFilter?.(v);
                    return;
                  }}
                />
              </Flex>
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
            setMetricGroupsFilter?.([]);
            setSliceTagsFilter?.([]);
          }}
        >
          Clear
        </Link>
      ) : null}
    </Flex>
  );
}
