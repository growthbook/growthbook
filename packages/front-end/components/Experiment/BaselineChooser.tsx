import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "back-end/types/report";
import clsx from "clsx";
import { useState } from "react";
import { FaCheck } from "react-icons/fa";
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

  // baseline selection is still WIP:
  const dropdownEnabled = false;

  const title = (
    <div className="d-inline-flex align-items-center">
      <div
        className={`variation variation${baselineVariation.index} with-variation-label d-flex align-items-center`}
      >
        <span className="label" style={{ width: 20, height: 20 }}>
          {baselineVariation.index}
        </span>
        <span
          className="d-inline-block text-ellipsis hover"
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
    <div>
      <div className="uppercase-title text-muted">Baseline</div>
      <Dropdown
        uuid={"baseline-selector"}
        right={false}
        className="mt-3"
        toggleClassName={clsx({
          "dropdown-underline": dropdownEnabled,
          "dropdown-underline-disabled": !dropdownEnabled,
        })}
        header={<div className="h6 mb-0">Baseline variation</div>}
        toggle={<div className="d-inline-flex align-items-center">{title}</div>}
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
              className="d-flex align-items-center hover-highlight px-3 py-1"
            >
              <div
                className="d-flex align-items-center flex-1 cursor-pointer py-2"
                onClick={() => {
                  selectVariation();
                  setOpen(false);
                }}
              >
                <div
                  className="flex align-items-center justify-content-center px-1 mr-2"
                  style={{ width: 20 }}
                >
                  {baselineVariation.index === variation.index && <FaCheck />}
                </div>
                <div
                  className={`variation variation${variation.index} with-variation-label d-flex align-items-center`}
                >
                  <span
                    className="label"
                    style={{ width: 20, height: 20, flex: "none" }}
                  >
                    {variation.index}
                  </span>
                  <span
                    className="d-inline-block"
                    style={{
                      width: 150,
                      lineHeight: "14px",
                    }}
                  >
                    {variation.name}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </Dropdown>
    </div>
  );
}
