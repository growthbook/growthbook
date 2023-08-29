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
  const indexedVariations = variations.map<ExperimentReportVariationWithIndex>(
    (v, i) => ({ ...v, index: i })
  );
  const validVariations = indexedVariations.filter(
    (v) => v.index !== baselineRow
  );
  const filteredVariations = validVariations.filter(
    (v) => !variationFilter.includes(v.index)
  );
  const requiresDropdown = validVariations.length > 1;

  let title = (
    <div
      className={clsx("d-inline-block btn-link", {
        "btn-link": requiresDropdown,
      })}
    >
      <span className="font-weight-bold ">All variations</span>
    </div>
  );
  if (filteredVariations.length < validVariations.length) {
    title = (
      <div
        className={clsx("d-inline-block btn-link", {
          "btn-link": requiresDropdown,
        })}
      >
        <span className="font-weight-bold">
          {filteredVariations.length} Variations
        </span>
      </div>
    );
  }
  if (filteredVariations.length <= 1) {
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
        {validVariations.length <= 1 ? null : (
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

        {indexedVariations.map((variation) => {
          if (variation.index === baselineRow) return null;
          const canClick =
            validVariations.length > 1 ||
            !filteredVariations.map((v) => v.index).includes(variation.index);

          const toggleVariation = () => {
            if (!canClick) return;
            if (variationFilter.includes(variation.index)) {
              setVariationFilter(
                variationFilter.filter((v) => v !== variation.index)
              );
            } else {
              setVariationFilter([...variationFilter, variation.index]);
            }
          };

          const selectVariation = () => {
            setVariationFilter(
              validVariations
                .filter((v) => v.index !== variation.index)
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
                  id={`variation-filter-checkbox-${variation.index}`}
                  type="checkbox"
                  style={{
                    pointerEvents: "none",
                    verticalAlign: "-3px",
                    width: 16,
                    height: 16,
                    opacity: canClick ? 1 : 0.5,
                  }}
                  checked={!variationFilter.includes(variation.index)}
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
                    className={`variation variation${variation.index} with-variation-label d-flex align-items-center`}
                  >
                    <span
                      className="label skip-underline"
                      style={{ width: 16, height: 16 }}
                    >
                      {variation.index}
                    </span>
                    <span
                      className="d-inline-block text-ellipsis font-weight-bold"
                      style={{
                        maxWidth: 200,
                      }}
                    >
                      {variation.name}
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
