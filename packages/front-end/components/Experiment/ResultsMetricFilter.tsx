import { MdFilterAlt, MdOutlineFilterAltOff } from "react-icons/md";
import React from "react";
import { Flex, Box, Heading } from "@radix-ui/themes";
import { PiX } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Checkbox from "@/ui/Checkbox";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";

export default function ResultsMetricFilter({
  metricTags = [],
  metricTagFilter = [],
  setMetricTagFilter,
  availableMetricGroups = [],
  metricGroupsFilter = [],
  setMetricGroupsFilter,
  sortBy,
  setSortBy,
  showMetricFilter,
  setShowMetricFilter,
}: {
  metricTags?: string[];
  metricTagFilter?: string[];
  setMetricTagFilter?: (tags: string[]) => void;
  availableMetricGroups?: Array<{ id: string; name: string }>;
  metricGroupsFilter?: string[];
  setMetricGroupsFilter?: (groups: string[]) => void;
  sortBy?: "metric-tags" | "significance" | "change" | "custom" | null;
  setSortBy?: (
    s: "metric-tags" | "significance" | "change" | "custom" | null,
  ) => void;
  showMetricFilter: boolean;
  setShowMetricFilter: (show: boolean) => void;
}) {
  const filteringApplied =
    metricTagFilter?.length > 0 ||
    metricGroupsFilter?.length > 0 ||
    sortBy === "metric-tags";

  return (
    <div
      className="col position-relative d-flex align-items-end px-0 font-weight-normal"
      style={{ maxWidth: 20 }}
    >
      <Popover
        side="top"
        align="start"
        showCloseButton
        open={showMetricFilter}
        onOpenChange={setShowMetricFilter}
        triggerAsChild={false}
        contentStyle={{ padding: "12px 16px 8px 16px" }}
        trigger={
          <Tooltip
            body={
              filteringApplied
                ? "Metric filters applied"
                : "No metric filters applied"
            }
            usePortal={true}
            shouldDisplay={!showMetricFilter}
          >
            <a
              role="button"
              onClick={() => setShowMetricFilter(!showMetricFilter)}
              className="d-inline-block px-1"
              style={{
                color: filteringApplied ? "var(--blue-10)" : "var(--gray-a8)",
                userSelect: "none",
              }}
            >
              {filteringApplied ? (
                <MdFilterAlt
                  className="position-relative"
                  style={{ bottom: 1 }}
                />
              ) : (
                <MdOutlineFilterAltOff
                  className="position-relative"
                  style={{ bottom: 1 }}
                />
              )}
            </a>
          </Tooltip>
        }
        content={
          <Flex
            direction="column"
            justify="between"
            style={{ width: 350, minHeight: 180 }}
          >
            <Box>
              <Heading size="3" weight="medium" mb="3">
                <MdFilterAlt
                  className="position-relative mr-1"
                  style={{ bottom: 2 }}
                />
                Filter Results
              </Heading>
              {availableMetricGroups.length > 0 && (
                <Box mb="4">
                  <Heading size="2" weight="medium">
                    By metric groups
                  </Heading>
                  <MultiSelectField
                    customClassName="multiselect-unfixed"
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
                </Box>
              )}
              <Box>
                <Heading size="2" weight="medium">
                  By metric tags
                </Heading>
                <MultiSelectField
                  customClassName="multiselect-unfixed"
                  value={metricTagFilter || []}
                  options={metricTags.map((tag) => ({
                    label: tag,
                    value: tag,
                  }))}
                  onChange={(v) => {
                    setMetricTagFilter?.(v);
                    if (v.length === 0 && sortBy === "metric-tags") {
                      setSortBy?.(null);
                    }
                    return;
                  }}
                />
              </Box>
              <Checkbox
                label="Also sort by tag order"
                labelSize="1"
                mt="3"
                value={sortBy === "metric-tags"}
                disabled={!metricTagFilter || metricTagFilter.length === 0}
                setValue={(value) => {
                  setSortBy?.(value ? "metric-tags" : null);
                }}
              />
            </Box>
            {filteringApplied ? (
              <Flex mt="4" justify="end">
                <Button
                  size="xs"
                  variant="ghost"
                  color="red"
                  icon={<PiX />}
                  onClick={async () => {
                    setMetricTagFilter?.([]);
                    setMetricGroupsFilter?.([]);
                    setSortBy?.(null);
                  }}
                >
                  Clear filters
                </Button>
              </Flex>
            ) : null}
          </Flex>
        }
      />
    </div>
  );
}
