import { MdFilterAlt, MdOutlineFilterAltOff } from "react-icons/md";
import React, { useEffect } from "react";
import { FaX } from "react-icons/fa6";
import { useForm } from "react-hook-form";
import SelectField from "@/components/Forms/SelectField";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import { Popover } from "@/ui/Popover";
import Link from "@/ui/Link";

export default function ResultsVariationsFilter({
  variationNames,
  variationRanks,
  showVariations,
  setShowVariations,
  variationsSort,
  setVariationsSort,
  showVariationsFilter,
  setShowVariationsFilter,
}: {
  variationNames: string[];
  variationRanks: number[];
  showVariations: boolean[];
  setShowVariations: (v: boolean[]) => void;
  variationsSort: "default" | "ranked";
  setVariationsSort: (v: "default" | "ranked") => void;
  showVariationsFilter: boolean;
  setShowVariationsFilter: (show: boolean) => void;
}) {
  const form = useForm<{
    filterVariations: "all" | "5" | "3";
  }>({
    defaultValues: {
      filterVariations: "all",
    },
  });
  const filterVariations = form.watch("filterVariations");

  // handle variation filter selector
  useEffect(
    () => {
      let sv = [...showVariations];
      if (filterVariations === "all") {
        sv = variationNames.map(() => true);
        setShowVariations(sv);
        return;
      }
      if (filterVariations === "5") {
        sv = variationNames.map((_, i) => variationRanks[i] <= 5);
      } else if (filterVariations === "3") {
        sv = variationNames.map((_, i) => variationRanks[i] <= 3);
      }
      setShowVariations(sv);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterVariations],
  );

  const filteringApplied =
    form.watch("filterVariations") !== "all" || variationsSort !== "default";

  return (
    <div
      className="col position-relative d-flex align-items-end px-0 font-weight-normal"
      style={{ maxWidth: 20 }}
    >
      <Popover
        open={showVariationsFilter}
        onOpenChange={setShowVariationsFilter}
        side="bottom"
        align="start"
        showCloseButton
        contentStyle={{ width: 245 }}
        trigger={
          <Link
            title={
              filteringApplied
                ? "Variation filters applied"
                : "No variation filters applied"
            }
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
          </Link>
        }
        content={
          <>
            <div className="mt-1 mb-4">
              <label className="uppercase-title mb-1">Order variations</label>
              <ButtonSelectField
                className="w-100"
                value={variationsSort}
                options={[
                  {
                    label: "Default Order",
                    value: "default",
                  },
                  {
                    label: "By Probability",
                    value: "ranked",
                  },
                ]}
                setValue={(v) => setVariationsSort(v as "default" | "ranked")}
              />
            </div>

            <div className="mt-3 mb-2">
              <label className="uppercase-title mb-0">Filter variations</label>
              <SelectField
                containerClassName="select-dropdown-underline"
                isSearchable={false}
                sort={false}
                disabled={variationNames.length <= 3}
                options={[
                  {
                    label: "All variations",
                    value: "all",
                  },
                  ...(variationNames.length > 5
                    ? [
                        {
                          label: "Top 5",
                          value: "5",
                        },
                      ]
                    : []),
                  ...(variationNames.length > 3
                    ? [
                        {
                          label: "Top 3",
                          value: "3",
                        },
                      ]
                    : []),
                ]}
                value={form.watch("filterVariations")}
                onChange={(v) => {
                  form.setValue("filterVariations", v as "all" | "5" | "3");
                }}
              />
            </div>

            <div className="d-flex mt-2">
              {filteringApplied ? (
                <button
                  className="btn btn-sm btn-link px-0"
                  onClick={(e) => {
                    e.preventDefault();
                    form.setValue("filterVariations", "all");
                    setVariationsSort("default");
                    setShowVariationsFilter(false);
                  }}
                >
                  <FaX className="mr-1" />
                  Clear filters
                </button>
              ) : null}
              <div className="flex-1" />
              <button
                className="btn btn-link"
                onClick={(e) => {
                  e.preventDefault();
                  setShowVariationsFilter(false);
                }}
              >
                Close
              </button>
            </div>
          </>
        }
      />
    </div>
  );
}
