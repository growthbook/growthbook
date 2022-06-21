import { ExperimentValue, FeatureValueType } from "back-end/types/feature";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { getDefaultVariationValue } from "../../services/features";
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

// Returns n "equal" decimals rounded to 2 places that add up to 1
// The sum always adds to 1. In some cases the values are not equal.
// For example, getEqualWeights(3) returns [0.34, 0.33, 0.33]
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
      return +(w + d).toFixed(2);
    });
}

function percentToDecimal(val: string): number {
  return parseFloat((parseFloat(val) / 100).toFixed(2));
}
function decimalToPercent(val: string): number {
  return Math.round(parseFloat(val) * 100);
}
function floatRound(val: number): number {
  return parseFloat(val.toFixed(2));
}

function getWeightExcept(variationValues: ExperimentValue[], i): number {
  let total = 0;
  variationValues.forEach((v, j) => {
    if (j !== i) {
      total += v.weight;
    }
  });
  return floatRound(total);
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
  let isEqualWeights = true;
  values.fields.forEach((v, i) => {
    if (
      form.watch(`${formPrefix}values.${0}.weight`) !==
      form.watch(`${formPrefix}values.${i}.weight`)
    ) {
      isEqualWeights = false;
    }
  });
  const [customSplit, setCustomSplit] = useState(!isEqualWeights);
  const variationValues: ExperimentValue[] = values.fields.map((v, i) => {
    return {
      weight: form.watch(`${formPrefix}values.${i}.weight`),
      value: form.watch(`${formPrefix}values.${i}.value`),
      name: form.watch(`${formPrefix}values.${i}.name`),
    };
  });

  const rebalance = (i: number) => {
    const newValue = form.watch(`${formPrefix}values.${i}.weight`);
    const currentTotal = getWeightExcept(variationValues, i) + newValue;

    const nextValue = floatRound(
      parseFloat(
        form.watch(
          `${formPrefix}values.${(i + 1) % values.fields.length}.weight`
        )
      )
    );
    if (currentTotal < 1) {
      // we are under the limit, so we can add the diff:
      form.setValue(
        `${formPrefix}values.${(i + 1) % values.fields.length}.weight`,
        floatRound(nextValue + (1 - currentTotal))
      );
    } else if (currentTotal > 1) {
      let overage = floatRound(currentTotal - 1);
      // the sum is over the limit
      // loop through the other variations (in order) and adjust until we're under the limit.
      let j = 1;
      while (overage > 0 && j < values.fields.length) {
        const nextValue = floatRound(
          parseFloat(
            form.watch(
              `${formPrefix}values.${(j + i) % values.fields.length}.weight`
            )
          )
        );
        const adjustedValue =
          nextValue >= overage ? floatRound(nextValue - overage) : 0;
        overage = floatRound(overage - (nextValue - adjustedValue));
        form.setValue(
          `${formPrefix}values.${(j + i) % values.fields.length}.weight`,
          adjustedValue
        );
        j++;
      }
    }
  };

  return (
    <div className="form-group">
      <label>Exposure, Variations and Weights</label>
      <div className="gbtable bg-light">
        <div className="p-2 pb-0 border-bottom">
          <label>
            Percent of traffic exposed to this experiment{" "}
            <Tooltip text="Unallocated traffic will skip this rule." />
          </label>
          <div className="row align-items-center pb-3 p-2">
            <div className="col">
              <input
                value={form.watch(`${formPrefix}coverage`)}
                onChange={(e) => {
                  form.setValue(
                    `${formPrefix}coverage`,
                    parseFloat(e.target.value).toFixed(3)
                  );
                }}
                min="0"
                max="1"
                step="0.01"
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
                  value={parseFloat(
                    (form.watch(`${formPrefix}coverage`) * 100).toFixed(3)
                  )}
                  onChange={(e) => {
                    let decimal = parseFloat(
                      (parseFloat(e.target.value) / 100).toFixed(3)
                    );
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
                      className={`${styles.colorMarker} ${
                        "variationColor" + (i % 9)
                      }`}
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
                      {...form.register(`${formPrefix}values.${i}.name`)}
                    />
                  </td>
                  <td>
                    <div className="row">
                      {customSplit ? (
                        <div className="col d-flex flex-row">
                          <input
                            value={(
                              form.watch(`${formPrefix}values.${i}.weight`) *
                              100
                            ).toFixed(0)}
                            onChange={(e) => {
                              form.setValue(
                                `${formPrefix}values.${i}.weight`,
                                percentToDecimal(e.target.value)
                              );
                              rebalance(i);
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
                              value={decimalToPercent(
                                form.watch(`${formPrefix}values.${i}.weight`)
                              )}
                              onChange={(e) => {
                                // the split now should add to 100% if there are two variations.
                                let newValue = percentToDecimal(e.target.value);
                                if (newValue > 1) newValue = 1;
                                if (newValue < 0) newValue = 0;
                                form.setValue(
                                  `${formPrefix}values.${i}.weight`,
                                  newValue
                                );
                                rebalance(i);
                              }}
                              type="number"
                              min={0}
                              max={100}
                              step="1"
                              className={styles.percentInput}
                            />
                            <span>%</span>
                          </div>
                        </div>
                      ) : (
                        <div className="col d-flex flex-row">
                          {parseFloat(
                            form.watch(`${formPrefix}values.${i}.weight`)
                          ) * 100}
                          %
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
            {valueType !== "boolean" && (
              <tr>
                <td colSpan={4}>
                  <div className="row">
                    <div className="col">
                      <a
                        className="btn btn-outline-primary"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          values.append({
                            value: getDefaultVariationValue(defaultValue),
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
                    </div>
                    <div className="col-auto">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          const weights = getEqualWeights(values.fields.length);
                          values.fields.forEach((v, i) => {
                            form.setValue(
                              `${formPrefix}values.${i}.weight`,
                              weights[i]
                            );
                          });
                          //rebalance(0);
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
                  coverage={form.watch(`${formPrefix}coverage`)}
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
