import { ExperimentValue, FeatureValueType } from "back-end/types/feature";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import {
  getDefaultVariationValue,
  getVariationColor,
  getVariationDefaultName,
} from "../../services/features";
import Field from "../Forms/Field";
import FeatureValueField from "./FeatureValueField";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import { GBAddCircle } from "../Icons";
import React, { useState } from "react";
import styles from "./VariationsInput.module.scss";
import Tooltip from "../Tooltip";

export interface Props {
  valueType: FeatureValueType;
  defaultValue: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  formPrefix?: string;
}

// Returns n "equal" decimals rounded to 3 places that add up to 1
// The sum always adds to 1. In some cases the values are not equal.
// For example, getEqualWeights(3) returns [0.334, 0.333, 0.333]
function getEqualWeights(n: number): number[] {
  const w = Math.round(1000 / n) / 1000;
  const diff = w * n - 1;
  const nDiffs = Math.round(Math.abs(diff) * 1000);
  return Array(n)
    .fill(0)
    .map((v, i) => {
      const j = n - i - 1;
      let d = 0;
      if (diff < 0 && i < nDiffs) d = 0.001;
      else if (diff > 0 && j < nDiffs) d = -0.001;
      return +(w + d).toFixed(3);
    });
}

function percentToDecimal(val: string): number {
  return parseFloat((parseFloat(val) / 100).toFixed(3));
}
function decimalToPercent(val: number): number {
  return parseFloat((val * 100).toFixed(1));
}
function floatRound(val: number): number {
  return parseFloat(val.toFixed(3));
}

// Updates one of the variation weights and rebalances
// the rest of the weights to keep the sum equal to 1
function rebalance(weights: number[], i: number, newValue: number): number[] {
  // Clamp new value
  if (newValue > 1) newValue = 1;
  if (newValue < 0) newValue = 0;

  // Update the new value
  weights = [...weights];
  weights[i] = newValue;

  // Current sum of weights
  const currentTotal = floatRound(weights.reduce((sum, w) => sum + w, 0));
  // The sum is too low, increment the next variation's weight
  if (currentTotal < 1) {
    const nextIndex = (i + 1) % weights.length;
    const nextValue = floatRound(weights[nextIndex]);
    weights[(i + 1) % weights.length] = floatRound(
      nextValue + (1 - currentTotal)
    );
  } else if (currentTotal > 1) {
    // The sum is too high, loop through the other variations and decrement weights
    let overage = floatRound(currentTotal - 1);
    let j = 1;
    while (overage > 0 && j < weights.length) {
      const nextIndex = (j + i) % weights.length;
      const nextValue = floatRound(weights[nextIndex]);
      const adjustedValue =
        nextValue >= overage ? floatRound(nextValue - overage) : 0;
      overage = floatRound(overage - (nextValue - adjustedValue));
      weights[nextIndex] = adjustedValue;
      j++;
    }
  }

  return weights;
}

export default function VariationsInput({
  form,
  formPrefix = "",
  valueType,
  defaultValue,
}: Props) {
  const values = useFieldArray({
    control: form.control,
    name: `${formPrefix}values`,
  });

  const variationValues: ExperimentValue[] = values.fields.map((v, i) => {
    return {
      weight: form.watch(`${formPrefix}values.${i}.weight`),
      value: form.watch(`${formPrefix}values.${i}.value`),
      name: form.watch(`${formPrefix}values.${i}.name`),
    };
  });
  const weights = variationValues.map((v) => v.weight);
  const coverage: number = form.watch(`${formPrefix}coverage`);

  const isEqualWeights = weights.every((w) => w === weights[0]);
  const [customSplit, setCustomSplit] = useState(!isEqualWeights);

  const rebalanceAndUpdate = (i: number, newValue: number) => {
    rebalance(weights, i, newValue).forEach((w, j) => {
      // The weight needs updating
      if (w !== weights[j]) {
        form.setValue(`${formPrefix}values.${j}.weight`, w);
      }
    });
  };

  return (
    <div className="form-group">
      <label>Exposure, Variations and Weights</label>
      <div className="gbtable bg-light">
        <div className="p-3 pb-0 border-bottom">
          <label>
            Percent of traffic included in this experiment{" "}
            <Tooltip text="Users not included in the experiment will skip this rule." />
          </label>
          <div className="row align-items-center pb-3">
            <div className="col">
              <input
                value={decimalToPercent(coverage)}
                onChange={(e) => {
                  let decimal = percentToDecimal(e.target.value);
                  if (decimal > 1) decimal = 1;
                  if (decimal < 0) decimal = 0;
                  form.setValue(`${formPrefix}coverage`, decimal);
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
                  value={decimalToPercent(coverage)}
                  onChange={(e) => {
                    let decimal = percentToDecimal(e.target.value);
                    if (decimal > 1) decimal = 1;
                    if (decimal < 0) decimal = 0;
                    form.setValue(`${formPrefix}coverage`, decimal);
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
              <th>Variation</th>
              <th>
                Name{" "}
                <Tooltip text="Optional way to identify the variations within GrowthBook." />
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
            {values.fields.map((val, i) => {
              return (
                <tr key={i}>
                  <td style={{ width: 45 }} className="position-relative pl-3">
                    <div
                      style={{
                        backgroundColor: getVariationColor(i),
                      }}
                    />
                    {i}
                  </td>
                  <td>
                    <FeatureValueField
                      label=""
                      form={form}
                      field={`${formPrefix}values.${i}.value`}
                      valueType={valueType}
                    />
                  </td>
                  <td>
                    <Field
                      label=""
                      placeholder={`${getVariationDefaultName(
                        variationValues[i],
                        valueType
                      )}`}
                      {...form.register(`${formPrefix}values.${i}.name`)}
                    />
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
                            step="0.1"
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
                                  percentToDecimal(e.target.value)
                                );
                              }}
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
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
                      {values.fields.length > 2 && (
                        <div className="col-auto">
                          <button
                            className="btn btn-link text-danger"
                            onClick={(e) => {
                              e.preventDefault();
                              values.remove(i);
                            }}
                            type="button"
                          >
                            remove
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {(valueType !== "boolean" || !isEqualWeights) && (
              <tr>
                <td colSpan={4}>
                  <div className="row">
                    <div className="col">
                      {valueType !== "boolean" && (
                        <a
                          className="btn btn-outline-primary"
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            values.append({
                              value: getDefaultVariationValue(defaultValue),
                              name: "",
                              weight: 0,
                            });
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
                    </div>

                    <div className="col-auto text-right">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          getEqualWeights(values.fields.length).forEach(
                            (w, i) => {
                              form.setValue(
                                `${formPrefix}values.${i}.weight`,
                                w
                              );
                            }
                          );
                        }}
                      >
                        set equal weights
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={4} className="pb-2">
                <ExperimentSplitVisual
                  coverage={coverage}
                  values={variationValues}
                  type={valueType}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
