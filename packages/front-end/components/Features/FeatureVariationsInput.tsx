import { FeatureValueType } from "back-end/types/feature";
import React, { useState } from "react";
import { FaInfoCircle } from "react-icons/fa";
import {
  decimalToPercent,
  distributeWeights,
  getEqualWeights,
  percentToDecimal,
} from "@/services/utils";
import {
  generateVariationId,
  getDefaultVariationValue,
} from "@/services/features";
import { GBAddCircle } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";
import styles from "./VariationsInput.module.scss";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import {
  SortableFeatureVariationRow,
  SortableVariation,
} from "./SortableFeatureVariationRow";
import SortableVariationsList from "./SortableVariationsList";

export interface Props {
  valueType: FeatureValueType;
  defaultValue?: string;
  variations: SortableVariation[];
  setWeight: (i: number, weight: number) => void;
  setVariations?: (variations: SortableVariation[]) => void;
  coverage: number;
  setCoverage: (coverage: number) => void;
  coverageTooltip?: string;
  valueAsId?: boolean;
  showPreview?: boolean;
  hideCoverage?: boolean;
  hideVariations?: boolean;
  label?: string;
}

export default function FeatureVariationsInput({
  variations,
  setVariations,
  setWeight,
  coverage,
  setCoverage,
  valueType,
  defaultValue = "",
  coverageTooltip = "Users not included in the experiment will skip this rule.",
  valueAsId = false,
  showPreview = true,
  hideCoverage = false,
  hideVariations = false,
  label,
}: Props) {
  const weights = variations.map((v) => v.weight);
  const isEqualWeights = weights.every((w) => w === weights[0]);
  const [customSplit, setCustomSplit] = useState(!isEqualWeights);

  const setEqualWeights = () => {
    getEqualWeights(variations.length).forEach((w, i) => {
      setWeight(i, w);
    });
  };

  return (
    <div className="form-group">
      {label ? (
        <label>{label}</label>
      ) : setVariations ? (
        <label>Exposure, Variations and Weights</label>
      ) : hideCoverage ? (
        <label>Traffic Split</label>
      ) : (
        <label>Exposure and Weights</label>
      )}
      <div className="gbtable bg-light">
        {!hideCoverage && (
          <div className="p-3 pb-0 border-bottom">
            <label>
              Percent of traffic included in this experiment{" "}
              <Tooltip body={coverageTooltip} />
            </label>
            <div className="row align-items-center pb-3">
              <div className="col">
                <input
                  value={isNaN(coverage) ? 0 : decimalToPercent(coverage)}
                  onChange={(e) => {
                    let decimal = percentToDecimal(e.target.value);
                    if (decimal > 1) decimal = 1;
                    if (decimal < 0) decimal = 0;
                    setCoverage(decimal);
                  }}
                  min="0"
                  max="100"
                  step="1"
                  type="range"
                  className="w-100"
                />
              </div>
              <div
                className={`col-auto ${styles.percentInputWrap}`}
                style={{ fontSize: "1em" }}
              >
                <div className="form-group mb-0 position-relative">
                  <input
                    className={`form-control ${styles.percentInput}`}
                    value={isNaN(coverage) ? "" : decimalToPercent(coverage)}
                    onChange={(e) => {
                      let decimal = percentToDecimal(e.target.value);
                      if (decimal > 1) decimal = 1;
                      if (decimal < 0) decimal = 0;
                      setCoverage(decimal);
                    }}
                    type="number"
                    min={0}
                    max={100}
                    step="1"
                  />
                  <span>%</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {!hideVariations && (
          <table className="table bg-light mb-0">
            <thead className={`${styles.variationSplitHeader}`}>
              <tr>
                <th className="pl-3">Id</th>
                {!valueAsId && <th>Variation</th>}
                <th>
                  <Tooltip
                    body="Optional way to identify the variations within GrowthBook."
                    tipPosition="top"
                  >
                    Name <FaInfoCircle />
                  </Tooltip>
                </th>
                <th>
                  Split
                  <div className="d-inline-block float-right form-check form-check-inline">
                    <label className="mb-0">
                      <input
                        type="checkbox"
                        className="form-check-input position-relative"
                        checked={customSplit}
                        value={1}
                        onChange={(e) => {
                          setCustomSplit(e.target.checked);
                          if (!e.target.checked) {
                            setEqualWeights();
                          }
                        }}
                        id="checkbox-customsplits"
                        style={{ top: "2px" }}
                      />{" "}
                      Customize split
                    </label>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <SortableVariationsList
                variations={variations}
                setVariations={setVariations}
              >
                {variations.map((variation, i) => (
                  <SortableFeatureVariationRow
                    i={i}
                    key={variation.id}
                    variation={variation}
                    variations={variations}
                    setVariations={setVariations}
                    setWeight={setWeight}
                    customSplit={customSplit}
                    valueType={valueType}
                    valueAsId={valueAsId}
                  />
                ))}
              </SortableVariationsList>
              <tr>
                <td colSpan={4}>
                  <div className="row">
                    <div className="col">
                      {valueType !== "boolean" && setVariations && (
                        <a
                          className="btn btn-outline-primary"
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();

                            const newWeights = distributeWeights(
                              [...weights, 0],
                              customSplit
                            );

                            // Add a new value and update weights
                            const newValues = [
                              ...variations,
                              {
                                value: getDefaultVariationValue(defaultValue),
                                name: "",
                                weight: 0,
                                id: generateVariationId(),
                              },
                            ];
                            newValues.forEach((v, i) => {
                              v.weight = newWeights[i] || 0;
                            });
                            setVariations(newValues);
                          }}
                        >
                          <span
                            className={`h4 pr-2 m-0 d-inline-block align-top`}
                          >
                            <GBAddCircle />
                          </span>
                          add another variation
                        </a>
                      )}
                      {valueType === "boolean" && (
                        <>
                          <Tooltip body="Boolean features can only have two variations. Use a different feature type to add multiple variations.">
                            <a className="btn btn-outline-primary disabled">
                              <span
                                className={`h4 pr-2 m-0 d-inline-block align-top`}
                              >
                                <GBAddCircle />
                              </span>
                              add another variation
                            </a>
                          </Tooltip>
                        </>
                      )}
                    </div>
                    {!isEqualWeights && (
                      <div className="col-auto text-right">
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setEqualWeights();
                          }}
                        >
                          set equal weights
                        </a>
                      </div>
                    )}
                  </div>
                </td>
              </tr>

              {showPreview && (
                <tr>
                  <td colSpan={4} className="pb-2">
                    <ExperimentSplitVisual
                      coverage={coverage}
                      values={variations}
                      type={valueType}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
