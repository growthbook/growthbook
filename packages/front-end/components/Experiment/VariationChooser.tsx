import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "back-end/types/report";
import clsx from "clsx";
import { useState } from "react";
import Dropdown from "@/components/Dropdown/Dropdown";

export interface Props {
  variations: ExperimentReportVariation[];
  variationFilter: number[];
  setVariationFilter: (variationFilter: number[]) => void;
  baselineRow: number;
}

export default function VariationChooser({
  variations,
  variationFilter,
  setVariationFilter,
  baselineRow,
}: Props) {
  const [open, setOpen] = useState(false);
  const filteredVariations = variations
    .map<ExperimentReportVariationWithIndex>((v, i) => ({ ...v, index: i }))
    .filter((_, i) => !variationFilter.includes(i));
  const requiresDropdown = variations.length > 2;

  let title = (
    <div
      className={clsx("d-inline-block btn-link", {
        "btn-link": requiresDropdown,
      })}
    >
      <span className="font-weight-bold ">All variations</span>
    </div>
  );
  if (filteredVariations.length <= variations.length - 1) {
    title = (
      <div
        className={clsx("d-inline-block btn-link", {
          "btn-link": requiresDropdown,
        })}
      >
        <span className="font-weight-bold">
          {filteredVariations.length - 1} Variations
        </span>
      </div>
    );
  }
  if (filteredVariations.length <= 2) {
    title = (
      <div
        className={clsx("d-inline-flex align-items-center", {
          "variation-chooser-hover-underline": requiresDropdown,
        })}
      >
        <div
          className={`variation variation${
            filteredVariations[filteredVariations.length - 1].index
          } with-variation-label d-flex align-items-center`}
        >
          <span
            className="label skip-underline"
            style={{ width: 20, height: 20 }}
          >
            {filteredVariations[filteredVariations.length - 1].index}
          </span>
          <span
            className="d-inline-block text-ellipsis font-weight-bold"
            style={{
              maxWidth: 150,
            }}
          >
            {filteredVariations[filteredVariations.length - 1].name}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <Dropdown
        uuid={"variation-filter"}
        right={false}
        className="mt-2"
        toggleClassName="mr-2"
        toggle={
          <div
            className="d-inline-flex align-items-center"
            style={{ height: 38 }}
          >
            {title}
          </div>
        }
        caret={requiresDropdown}
        enabled={requiresDropdown}
        open={open}
        setOpen={(b: boolean) => setOpen(b)}
      >
        {variations.length <= 2 ? null : (
          <div className="d-flex align-items-center px-3 py-1 cursor-pointer">
            <div
              className={clsx("d-flex flex-1 align-items-center py-1", {
                "btn-link": variationFilter.length > 0,
              })}
              onClick={() => {
                setVariationFilter([]);
              }}
            >
              <div className="flex align-items-center justify-content-center px-1 mr-3">
                <input
                  readOnly
                  id={`variation-filter-checkbox-all`}
                  type="checkbox"
                  style={{
                    pointerEvents: "none",
                    verticalAlign: "-3px",
                    width: 16,
                    height: 16,
                    opacity: variationFilter.length > 0 ? 1 : 0.5,
                  }}
                  checked={variationFilter.length === 0}
                />
              </div>
              <div
                className={clsx("d-flex align-items-center", {
                  "text-muted": variationFilter.length === 0,
                })}
              >
                <em>select all</em>
              </div>
            </div>
          </div>
        )}

        {variations.map((variation, i) => {
          if (i === baselineRow) return null;
          const canClick =
            filteredVariations.length > 2 ||
            !filteredVariations.map((v) => v.index).includes(i);

          const toggleVariation = () => {
            if (variationFilter.includes(i)) {
              setVariationFilter(variationFilter.filter((v) => v !== i));
            } else {
              const newFilter = [...variationFilter, i];
              if (newFilter.length >= variations.length - 1) {
                return;
              }
              setVariationFilter(newFilter);
            }
          };

          const selectVariation = () => {
            setVariationFilter(
              variations
                .map<ExperimentReportVariationWithIndex>((v, i) => ({
                  ...v,
                  index: i,
                }))
                .filter((_, j) => j !== i && j !== baselineRow)
                .map((v) => v.index)
            );
          };

          return (
            <div
              key={variation.id}
              className="d-flex align-items-center px-3 py-1"
            >
              <div
                className="flex align-items-center justify-content-center cursor-pointer px-1 mr-3 py-1"
                onClick={toggleVariation}
              >
                <input
                  readOnly
                  id={`variation-filter-checkbox-${i}`}
                  type="checkbox"
                  style={{
                    pointerEvents: "none",
                    verticalAlign: "-3px",
                    width: 16,
                    height: 16,
                    opacity: canClick ? 1 : 0.5,
                  }}
                  checked={!variationFilter.includes(i)}
                />
              </div>
              <div
                className="d-flex align-items-center flex-1 variation-chooser-hover-underline cursor-pointer py-2"
                onClick={() => {
                  selectVariation();
                  setOpen(false);
                }}
              >
                <div className="mr-2">
                  <div
                    className={`variation variation${i} with-variation-label d-flex align-items-center`}
                  >
                    <span
                      className="label skip-underline"
                      style={{ width: 16, height: 16 }}
                    >
                      {i}
                    </span>
                    <span
                      className="d-inline-block text-ellipsis font-weight-bold"
                      style={{
                        maxWidth: 200,
                      }}
                    >
                      {variations[i].name}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </Dropdown>
    </>
  );
}
