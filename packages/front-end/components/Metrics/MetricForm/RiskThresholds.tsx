import React, { FC } from "react";
import { UseFormRegisterReturn } from "react-hook-form";

const RiskThresholds: FC<{
  winRisk: number;
  winRiskRegisterField: UseFormRegisterReturn;
  loseRisk: number;
  loseRiskRegisterField: UseFormRegisterReturn;
  riskError: string;
}> = ({
  winRisk,
  winRiskRegisterField,
  loseRisk,
  loseRiskRegisterField,
  riskError,
}) => {
  return (
    <div className="form-group">
      <label className="mb-1">Risk thresholds</label>
      <small className="d-block mb-1 text-muted">
        Only applicable to Bayesian analyses
      </small>
      <div className="p-2 border rounded">
        <div className="riskbar row align-items-center pt-2">
          <div className="col green-bar pr-0">
            <span
              style={{
                position: "absolute",
                top: "-20px",
                color: "#009a6d",
                fontSize: "0.7rem",
              }}
            >
              acceptable risk under {winRisk}%
            </span>
            <div
              style={{
                height: "10px",
                backgroundColor: "#009a6d",
                borderRadius: "5px 0 0 5px",
              }}
            ></div>
          </div>
          <div className="col-2 px-0">
            <span
              style={{
                position: "absolute",
                right: "4px",
                top: "6px",
                color: "#888",
              }}
            >
              %
            </span>
            <input
              className="form-control winrisk text-center"
              type="number"
              step="any"
              min="0"
              max="100"
              {...winRiskRegisterField}
            />
          </div>
          <div className="col yellow-bar px-0">
            <div
              style={{
                height: "10px",
                backgroundColor: "#dfd700",
              }}
            ></div>
          </div>
          <div className="col-2 px-0">
            <span
              style={{
                position: "absolute",
                right: "4px",
                top: "6px",
                color: "#888",
              }}
            >
              %
            </span>
            <input
              className="form-control loserisk text-center"
              type="number"
              step="any"
              min="0"
              max="100"
              {...loseRiskRegisterField}
            />
          </div>
          <div className="col red-bar pl-0">
            <span
              style={{
                position: "absolute",
                top: "-20px",
                right: "10px",
                color: "#c50f0f",
                fontSize: "0.7rem",
              }}
            >
              too much risk over {loseRisk}%
            </span>
            <div
              style={{
                height: "10px",
                backgroundColor: "#c50f0f",
                borderRadius: "0 5px 5px 0",
              }}
            ></div>
          </div>
        </div>
        {riskError && <div className="text-danger">{riskError}</div>}
        <small className="text-muted">
          Set the thresholds for risk for this metric. This is used to determine
          metric significance, highlighting the risk value as green, yellow, or
          red.
        </small>
      </div>
    </div>
  );
};

export default RiskThresholds;
