import { MdFilterAlt, MdOutlineFilterAltOff } from "react-icons/md";
import React, { useEffect, useState } from "react";
import { FaX } from "react-icons/fa6";
import { Flex, Text, Box } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { ResultsMetricFilters } from "@/components/Experiment/Results";
import Checkbox from "@/ui/Checkbox";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";

export default function ResultsMetricFilter({
  metricTags = [],
  metricFilter = {},
  setMetricFilter,
  showMetricFilter,
  setShowMetricFilter,
}: {
  metricTags?: string[];
  metricFilter?: ResultsMetricFilters;
  setMetricFilter: (filter: ResultsMetricFilters) => void;
  showMetricFilter: boolean;
  setShowMetricFilter: (show: boolean) => void;
}) {
  const [_metricFilter, _setMetricFilter] = useState(metricFilter);
  const _filteringApplied =
    _metricFilter?.tagOrder?.length || _metricFilter?.filterByTag;
  const filteringApplied =
    metricFilter?.tagOrder?.length || metricFilter?.filterByTag;

  useEffect(() => {
    // reset inputs on close
    if (!showMetricFilter) {
      _setMetricFilter(metricFilter);
    }
  }, [showMetricFilter, metricFilter, _setMetricFilter]);

  return (
    <div
      className="col position-relative d-flex align-items-end px-0 font-weight-normal"
      style={{ maxWidth: 20 }}
    >
      <Popover
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
              className={`d-inline-block px-1 ${
                filteringApplied ? "btn-link-filter-on" : "btn-link-filter-off"
              }`}
              style={{ transform: "scale(1.1)", marginRight: -4 }}
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
        triggerAsChild={false}
        content={
          <Box style={{ width: 280 }}>
            <div>
              <Text as="label" size="3" weight="bold" className="my-2">
                Order metrics by tag
              </Text>
              <MultiSelectField
                customClassName="multiselect-unfixed"
                value={_metricFilter?.tagOrder || []}
                options={metricTags.map((tag) => ({ label: tag, value: tag }))}
                onChange={(v) => {
                  _setMetricFilter({
                    ..._metricFilter,
                    tagOrder: v,
                    filterByTag:
                      v.length > 0 ? _metricFilter?.filterByTag : false,
                  });
                  return;
                }}
              />
              <Text size="1" color="gray">
                Drag &amp; drop tags to change display order
              </Text>
            </div>

            <Flex mt="3" align="center" gap="3">
              <Checkbox
                label="Filter metrics"
                mb="0"
                value={
                  _metricFilter?.tagOrder?.length
                    ? !!_metricFilter.filterByTag
                    : false
                }
                setValue={(value) => {
                  _setMetricFilter({
                    ..._metricFilter,
                    filterByTag: value,
                  });
                }}
                disabled={!_metricFilter?.tagOrder?.length}
              />
              {!_metricFilter?.tagOrder?.length ? (
                <Text size="1" color="gray" ml="2">
                  No tags selected
                </Text>
              ) : null}
            </Flex>
            <div className="d-flex mt-3">
              {_filteringApplied ? (
                <Button
                  size="xs"
                  variant="ghost"
                  color="gray"
                  icon={<FaX />}
                  onClick={async () => {
                    _setMetricFilter({});
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
              <div className="flex-1" />
              <Button
                size="xs"
                onClick={async () => {
                  setMetricFilter(_metricFilter);
                  setShowMetricFilter(false);
                }}
                disabled={
                  JSON.stringify(_metricFilter) === JSON.stringify(metricFilter)
                }
              >
                Apply
              </Button>
            </div>
          </Box>
        }
        side="bottom"
        align="start"
        showCloseButton
        open={showMetricFilter}
        onOpenChange={setShowMetricFilter}
      />
    </div>
  );
}
