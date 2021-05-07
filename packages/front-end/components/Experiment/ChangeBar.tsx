import clsx from "clsx";
import { FC } from "react";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const ChangeBar: FC<{
  change: number;
  minMax: [number, number];
  inverse: boolean;
}> = function ChangeBar({ change, minMax: [min, max], inverse }) {
  let left: number;
  let right: number;
  let zero: number;
  if (min < 0 && max > 0) {
    zero = (-1 * min) / (-1 * min + max);
    left = change < 0 ? (1 - change / min) * zero : zero;
    right = change > 0 ? 1 - (zero + (change / max) * (1 - zero)) : 1 - zero;
  } else if (max <= 0) {
    right = 0;
    left = min < 0 ? 1 - change / min : 0;
    zero = 1;
  } else if (min >= 0) {
    left = 0;
    right = max > 0 ? 1 - change / max : 0;
    zero = 0;
  }

  return (
    <div className="d-flex change-bar">
      <div
        className={clsx("label mr-1", {
          "text-success":
            (!inverse && change > 0.02) || (inverse && change < -0.02),
          "text-danger":
            (!inverse && change <= -0.02) || (inverse && change >= 0.02),
        })}
      >
        {percentFormatter.format(change)}
      </div>
      <div className="bar-holder">
        <div
          className={clsx("bar", {
            inverse: inverse,
            normal: !inverse,
            "bg-success":
              (!inverse && change > 0.02) || (inverse && change < -0.02),
            "bg-danger":
              (!inverse && change <= -0.02) || (inverse && change >= 0.02),
          })}
          style={{
            left: (left * 100).toFixed(1) + "%",
            right: (right * 100).toFixed(1) + "%",
          }}
        />
        <div
          className="zero"
          style={{
            left: (zero * 100).toFixed(1) + "%",
          }}
        />
      </div>
    </div>
  );
};

export default ChangeBar;
