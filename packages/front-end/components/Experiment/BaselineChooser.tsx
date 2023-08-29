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
  setBaselineRow: (baselineRow: number) => void;
}

export default function BaselineChooser({
  variations,
  // variationFilter,
  // setVariationFilter,
  baselineRow,
  setBaselineRow,
}: Props) {
  const [open, setOpen] = useState(false);
  const indexedVariations = variations.map<ExperimentReportVariationWithIndex>(
    (v, i) => ({ ...v, index: i })
  );
  const baselineVariation =
    indexedVariations.find((v) => v.index === baselineRow) ??
    indexedVariations[0];
  const dropdownEnabled = false;

  const title = (
    <div
      className={clsx("d-inline-flex align-items-center", {
        "variation-chooser-hover-underline": dropdownEnabled,
      })}
    >
      <div
        className={`variation variation${baselineVariation.index} with-variation-label d-flex align-items-center`}
      >
        <span
          className="label skip-underline"
          style={{ width: 20, height: 20 }}
        >
          {baselineVariation.index}
        </span>
        <span
          className="d-inline-block text-ellipsis font-weight-bold"
          style={{
            maxWidth: 150,
          }}
        >
          {baselineVariation.name}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <Dropdown
        uuid={"variation-filter"}
        right={false}
        className="mt-2"
        toggle={
          <div
            className="d-inline-flex align-items-center"
            style={{ height: 38 }}
          >
            {title}
          </div>
        }
        caret={dropdownEnabled}
        enabled={dropdownEnabled}
        open={open}
        setOpen={(b: boolean) => setOpen(b)}
      >
        {indexedVariations.map((variation) => {
          const selectVariation = () => {
            setBaselineRow(variation.index);
          };

          return (
            <div
              key={variation.id}
              className="d-flex align-items-center px-3 py-1"
            >
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
