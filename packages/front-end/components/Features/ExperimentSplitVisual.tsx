import clsx from "clsx";
import React, { CSSProperties } from "react";
import { ExperimentValue, FeatureValueType } from "back-end/types/feature";
import { FaExclamationTriangle } from "react-icons/fa";
import {
  getVariationColor,
  getVariationDefaultName,
} from "@/services/features";
import Tooltip from "../Tooltip/Tooltip";
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
    values.reduce((partialSum, v) => partialSum + v.weight, 0).toFixed(3)
  );

  const coverageVal = coverage ? coverage : 0;

  return (
    <div className={`${totalWeights > 1 ? "overflow-hidden" : ""}`}>
      <div className="row">
        <div className="col">
          <label>{label}</label>
          {totalWeights !== 1 && (
            <span className="ml-2 text-danger">
              <FaExclamationTriangle className="text-danger mr-2" />
              <span className="">Please adjust weights to sum to 100%.</span>
            </span>
          )}
        </div>
        {coverage < 1 && (
          <div className={clsx("col-auto", styles.legend)}>
            <div
              className={clsx(
                styles.legend_box,
                styles.used,
                "progress-bar-striped"
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
          height: 30,
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
                backgroundColor: getVariationColor(i),
              };
              if (!stackLeft) {
                additionalStyles.position = "absolute";
                additionalStyles.left = thisLeft + "%";
              }

              const valueDisplay = getVariationDefaultName(val, type);

              const variationLabel = `${valueDisplay} (${parseFloat(
                percentVal.toPrecision(5)
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
                      <span>
                        {parseFloat(percentVal.toPrecision(4)) + "%"}
                        {showValues && (
                          <>
                            {" "}
                            - <strong>{valueDisplay}</strong>
                          </>
                        )}
                      </span>
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
                    ((1 - coverageVal) * 100).toPrecision(5)
                  )}% - users will skip this rule`}
                  style={{ width: "100%", height: "100%" }}
                >
                  <></>
                </Tooltip>
                {showPercentages && (
                  <div className={`${styles.percentMarker}`}>
                    <span>
                      {parseFloat(((1 - coverageVal) * 100).toPrecision(5)) +
                        "%"}
                      {showValues && (
                        <>
                          {" "}
                          - <strong>unallocated</strong>
                        </>
                      )}
                    </span>
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
