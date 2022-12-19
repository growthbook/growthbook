import { ExperimentValue, FeatureValueType } from "back-end/types/feature";
import React, { useState } from "react";
import {
  getDefaultVariationValue,
  getVariationColor,
  getVariationDefaultName,
} from "@/services/features";
import {
  decimalToPercent,
  distributeWeights,
  getEqualWeights,
  percentToDecimal,
  rebalance,
} from "@/services/utils";
import Field from "../Forms/Field";
import { GBAddCircle } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";
import MoreMenu from "../Dropdown/MoreMenu";
import FeatureValueField from "./FeatureValueField";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import styles from "./VariationsInput.module.scss";

export interface Props {
  valueType: FeatureValueType;
  defaultValue?: string;
  variations: ExperimentValue[];
  setWeight: (i: number, weight: number) => void;
  setVariations?: (variations: ExperimentValue[]) => void;
  coverage: number;
  setCoverage: (coverage: number) => void;
  coverageTooltip?: string;
  valueAsId?: boolean;
  showPreview?: boolean;
}

export default function VariationsInput({
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
}: Props) {
  const weights = variations.map((v) => v.weight);
  const isEqualWeights = weights.every((w) => w === weights[0]);
  const [customSplit, setCustomSplit] = useState(!isEqualWeights);

  const rebalanceAndUpdate = (
    i: number,
    newValue: number,
    precision: number = 4
  ) => {
    rebalance(weights, i, newValue, precision).forEach((w, j) => {
      // The weight needs updating
      if (w !== weights[j]) {
        setWeight(j, w);
      }
    });
  };

  const setEqualWeights = () => {
    getEqualWeights(variations.length).forEach((w, i) => {
      setWeight(i, w);
    });
  };

  return (
    <div className="form-group">
      {setVariations ? (
        <label>Exposure, Variations and Weights</label>
      ) : (
        <label>Exposure and Weights</label>
      )}
      <div className="gbtable bg-light">
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
        <table className="table bg-light mb-0">
          <thead className={`${styles.variationSplitHeader}`}>
            <tr>
              <th className="pl-3">Id</th>
              {!valueAsId && <th>Variation</th>}
              <th>
                Name{" "}
                <Tooltip body="Optional way to identify the variations within GrowthBook." />
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
            {variations.map((val, i) => {
              return (
                <tr key={i}>
                  {!valueAsId && (
                    <td
                      style={{ width: 45 }}
                      className="position-relative pl-3"
                    >
                      <div
                        className={styles.colorMarker}
                        style={{
                          backgroundColor: getVariationColor(i),
                        }}
                      />
                      {i}
                    </td>
                  )}
                  <td>
                    {setVariations ? (
                      <FeatureValueField
                        id={`value_${i}`}
                        value={val.value}
                        placeholder={valueAsId ? i + "" : ""}
                        setValue={(value) => {
                          const newVariations = [...variations];
                          newVariations[i] = {
                            ...val,
                            value,
                          };
                          setVariations(newVariations);
                        }}
                        label=""
                        valueType={valueType}
                      />
                    ) : (
                      <>{val.value}</>
                    )}
                  </td>
                  <td>
                    {setVariations ? (
                      <Field
                        label=""
                        placeholder={`${getVariationDefaultName(
                          val,
                          valueType
                        )}`}
                        value={val.name || ""}
                        onChange={(e) => {
                          const newVariations = [...variations];
                          newVariations[i] = {
                            ...val,
                            name: e.target.value,
                          };
                          setVariations(newVariations);
                        }}
                      />
                    ) : (
                      <strong>{val.name || ""}</strong>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      {customSplit ? (
                        <div className="col d-flex flex-row">
                          <input
                            value={decimalToPercent(weights[i])}
                            onChange={(e) => {
                              rebalanceAndUpdate(
                                i,
                                percentToDecimal(e.target.value)
                              );
                            }}
                            min="0"
                            max="100"
                            step="0.01"
                            type="range"
                            className="w-100 mr-3"
                          />
                          <div
                            className={`position-relative ${styles.percentInputWrap}`}
                          >
                            <Field
                              value={decimalToPercent(weights[i])}
                              onChange={(e) => {
                                // the split now should add to 100% if there are two variations.
                                rebalanceAndUpdate(
                                  i,
                                  e.target.value === ""
                                    ? 0
                                    : percentToDecimal(e.target.value)
                                );
                                if (e.target.value === "") {
                                  // I hate this, but not is also the easiest
                                  setTimeout(() => {
                                    e.target.focus();
                                    e.target.select();
                                  }, 100);
                                }
                              }}
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              className={styles.percentInput}
                            />
                            <span>%</span>
                          </div>
                        </div>
                      ) : (
                        <div className="col d-flex flex-row">
                          {decimalToPercent(weights[i])}%
                        </div>
                      )}
                      {setVariations && (
                        <div className="col-auto">
                          <MoreMenu>
                            {i > 0 && (
                              <button
                                className="dropdown-item"
                                onClick={(e) => {
                                  e.preventDefault();

                                  const newValues = [...variations];
                                  [newValues[i], newValues[i - 1]] = [
                                    newValues[i - 1],
                                    newValues[i],
                                  ];

                                  setVariations(newValues);
                                }}
                              >
                                move up
                              </button>
                            )}
                            {i < variations.length - 1 && (
                              <button
                                className="dropdown-item"
                                onClick={(e) => {
                                  e.preventDefault();

                                  const newValues = [...variations];
                                  [newValues[i], newValues[i + 1]] = [
                                    newValues[i + 1],
                                    newValues[i],
                                  ];

                                  setVariations(newValues);
                                }}
                              >
                                move down
                              </button>
                            )}
                            {variations.length > 2 && (
                              <button
                                className="dropdown-item text-danger"
                                onClick={(e) => {
                                  e.preventDefault();

                                  const newValues = [...variations];
                                  newValues.splice(i, 1);

                                  const newWeights = distributeWeights(
                                    newValues.map((v) => v.weight),
                                    customSplit
                                  );

                                  newValues.forEach((v, j) => {
                                    v.weight = newWeights[j] || 0;
                                  });
                                  setVariations(newValues);
                                }}
                                type="button"
                              >
                                remove
                              </button>
                            )}
                          </MoreMenu>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            <tr>
              <td colSpan={4}>
                <div className="row">
                  <div className="col">
                    {valueType !== "boolean" && setVariations ? (
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
                    ) : (
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
      </div>
    </div>
  );
}
