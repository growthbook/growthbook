import clsx from "clsx";
import React, { CSSProperties } from "react";
import { ExperimentValue, FeatureValueType } from "shared/types/feature";
import {
  getVariationColor,
  getVariationDefaultName,
} from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import styles from "./ExperimentSplitVisual.module.scss";

export interface Props {
  label?: string;
  unallocated?: string;
  coverage: number;
  values: ExperimentValue[];
  showValues?: boolean;
  type: FeatureValueType;
  stackLeft?: boolean;
  showPercentages?: boolean;
}
export default function ExperimentSplitVisual({
  label = "Traffic Split Preview",
  unallocated = "Not included",
  coverage,
  values,
  showValues = false,
  type,
  stackLeft = false,
  showPercentages = true,
}: Props) {
  let previewLeft = 0;
  const totalWeights = parseFloat(
    values.reduce((partialSum, v) => partialSum + v.weight, 0).toFixed(3),
  );

  const coverageVal = coverage ? coverage : 0;

  return (
    <div className={`${totalWeights > 1 ? "overflow-hidden" : ""}`}>
      {totalWeights !== 1 ? (
        <Callout status="error" size="sm" mb="3">
          Please adjust weights to sum to 100%.
        </Callout>
      ) : null}
      <div className="row">
        <div className="col">
          <label>{label}</label>
        </div>
        {coverage < 1 && (
          <div className={clsx("col-auto", styles.legend)}>
            <div
              className={clsx(
                styles.legend_box,
                styles.used,
                "progress-bar-striped",
              )}
              style={{ backgroundColor: "#e0e0e0" }}
            />{" "}
            {unallocated}{" "}
            <strong>
              ({parseFloat(((1 - coverage) * 100).toPrecision(5)) + "%"})
            </strong>
          </div>
        )}
      </div>
      <div
        className="position-relative progress-bar-striped mb-5"
        style={{
          width: "100%",
          textAlign: "right",
          height: 20,
          backgroundColor: "#e0e0e0",
        }}
      >
        <div className="d-flex flex-row">
          <div className="w-100 d-flex flex-row">
            {values.map((val, i) => {
              const thisLeft = previewLeft;
              const percentVal =
                val.weight && coverage ? val.weight * coverage * 100 : 0;
              previewLeft += 100 * val.weight;
              const additionalStyles: CSSProperties = {
                width: percentVal + "%",
                height: 30,
                backgroundColor: getVariationColor(i, true),
              };
              if (!stackLeft) {
                additionalStyles.position = "absolute";
                additionalStyles.left = thisLeft + "%";
              }

              const valueDisplay = getVariationDefaultName(val, type);

              const variationLabel = `${valueDisplay} (${parseFloat(
                percentVal.toPrecision(5),
              )}%)`;

              return (
                <div
                  key={i}
                  className={`${styles.previewBar}`}
                  style={additionalStyles}
                >
                  <Tooltip
                    body={variationLabel}
                    style={{ width: "100%", height: "100%" }}
                  >
                    <></>
                  </Tooltip>
                  {showPercentages && (
                    <div className={`${styles.percentMarker}`}>
                      <span className="nowrap">
                        {parseFloat(percentVal.toPrecision(4)) +
                          "%"}
                      </span>
                      {showValues && (
                        <>
                          {" "}
                          - <strong>{valueDisplay}</strong>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {stackLeft && coverageVal < 1 && (
              <div
                className={`${styles.previewBar} unallocated`}
                style={{
                  position: "relative",
                  width: (1 - coverageVal) * 100 + "%",
                  height: 30,
                }}
              >
                <Tooltip
                  body={`Not included: ${parseFloat(
                    ((1 - coverageVal) * 100).toPrecision(5),
                  )}% - users will skip this rule`}
                  style={{ width: "100%", height: "100%" }}
                >
                  <></>
                </Tooltip>
                {showPercentages && (
                  <div className={`${styles.percentMarker}`}>
                    <span className="nowrap">
                      {parseFloat(((1 - coverageVal) * 100).toPrecision(5)) +
                        "%"}
                    </span>
                    {showValues && (
                      <>
                        {" "}
                        - <strong>unallocated</strong>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
