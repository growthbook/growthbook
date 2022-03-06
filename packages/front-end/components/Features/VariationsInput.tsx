import { FeatureValueType } from "back-end/types/feature";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { getDefaultVariationValue } from "../../services/features";
import Field from "../Forms/Field";
import FeatureValueField from "./FeatureValueField";
import Tooltip from "../Tooltip";
import { GBAddCircle } from "../Icons";
import React from "react";

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
  const w = Math.round(100 / n) / 100;
  const diff = w * n - 1;
  const nDiffs = Math.round(Math.abs(diff) * 100);
  return Array(n)
    .fill(0)
    .map((v, i) => {
      const j = n - i - 1;
      let d = 0;
      if (diff < 0 && i < nDiffs) d = 0.01;
      else if (diff > 0 && j < nDiffs) d = -0.01;
      return +(w + d).toFixed(2);
    });
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

  return (
    <div className="form-group">
      <label>Variations and Weights</label>
      <table className="table table-bordered gbtable bg-light">
        <thead>
          <tr>
            <th>Id</th>
            <th>Variation</th>
            <th>
              Percent of Users{" "}
              <Tooltip
                innerClassName="text-left"
                tipMinWidth={"200px"}
                text={
                  "The ratio of users (from 0 to 1) that sees each variation. Total sum must be less than or equal to 1. Anything left over will be excluded from the experiment."
                }
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {values.fields.map((val, i) => {
            return (
              <tr key={i}>
                <td style={{ width: 40 }}>{i}</td>
                <td>
                  <FeatureValueField
                    label=""
                    form={form}
                    field={`${formPrefix}values.${i}.value`}
                    valueType={valueType}
                  />
                </td>
                <td>
                  <div className="row">
                    <div className="col">
                      <Field
                        {...form.register(`${formPrefix}values.${i}.weight`, {
                          valueAsNumber: true,
                        })}
                        type="number"
                        min={0}
                        max={1}
                        step="0.01"
                      />
                    </div>
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
              <td colSpan={3}>
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
                      <span className={`h4 pr-2 m-0 d-inline-block align-top`}>
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
                      }}
                    >
                      set equal weights
                    </a>
                  </div>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
