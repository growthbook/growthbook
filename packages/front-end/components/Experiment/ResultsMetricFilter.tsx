import { MdFilterAlt, MdOutlineFilterAltOff } from "react-icons/md";
import React, { useEffect, useState } from "react";
import { BsXCircle } from "react-icons/bs";
import { FaX } from "react-icons/fa6";
import { Flex } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { ResultsMetricFilters } from "@/components/Experiment/Results";
import Checkbox from "@/ui/Checkbox";

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
            <MdFilterAlt className="position-relative" style={{ bottom: 1 }} />
          ) : (
            <MdOutlineFilterAltOff
              className="position-relative"
              style={{ bottom: 1 }}
            />
          )}
        </a>
      </Tooltip>
      <Tooltip
        tipPosition="bottom"
        usePortal={true}
        style={{ position: "absolute" }}
        popperStyle={{ marginLeft: 17, marginTop: -2 }}
        state={showMetricFilter}
        flipTheme={false}
        body={
          <div style={{ width: 280 }}>
            <a
              role="button"
              style={{
                top: 3,
                right: 5,
              }}
              className="position-absolute cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                setShowMetricFilter(false);
              }}
            >
              <BsXCircle size={16} />
            </a>

            <div>
              <label className="my-2">
                <h5 className="mb-0">Order metrics by tag</h5>
              </label>
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
              <small>Drag &amp; drop tags to change display order</small>
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
                <small className="text-muted ml-2">No tags selected</small>
              ) : null}
            </Flex>
            <div className="d-flex mt-3">
              {_filteringApplied ? (
                <button
                  className="btn btn-sm btn-link px-0"
                  onClick={(e) => {
                    e.preventDefault();
                    _setMetricFilter({});
                  }}
                >
                  <FaX className="mr-1" />
                  Clear filters
                </button>
              ) : null}
              <div className="flex-1" />
              <button
                className="btn btn-sm btn-primary"
                onClick={(e) => {
                  e.preventDefault();
                  setMetricFilter(_metricFilter);
                  setShowMetricFilter(false);
                }}
                disabled={
                  JSON.stringify(_metricFilter) === JSON.stringify(metricFilter)
                }
              >
                Apply
              </button>
            </div>
          </div>
        }
      >
        <></>
      </Tooltip>
    </div>
  );
}
