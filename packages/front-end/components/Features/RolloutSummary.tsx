import { FeatureInterface } from "back-end/types/feature";
import ValidateValue from "@front-end/components/Features/ValidateValue";
import ValueDisplay from "./ValueDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function RolloutSummary({
  value,
  coverage,
  feature,
  hashAttribute,
}: {
  value: string;
  coverage: number;
  feature: FeatureInterface;
  hashAttribute: string;
}) {
  const type = feature.valueType;
  return (
    <div>
      <div className="mb-3">
        <strong className="mr-2">SAMPLE</strong> users by{" "}
        <span className="mr-1 border px-2 py-1 bg-light rounded">
          {hashAttribute}
        </span>
      </div>
      <div className="mb-3">
        <div className="row">
          <div className="col-auto">
            <strong>ROLLOUT</strong>
          </div>
          <div className="col" style={{ maxWidth: 250 }}>
            <div className="progress d-none d-md-flex">
              <div
                className="progress-bar bg-info"
                style={{
                  width: coverage * 100 + "%",
                }}
              />
            </div>
          </div>
          <div className="col-auto">
            <span className="mr-1 border px-2 py-1 bg-light rounded">
              {percentFormatter.format(coverage)}
            </span>{" "}
            of users
          </div>
        </div>
      </div>
      <div className="row align-items-top">
        <div className="col-auto">
          <strong>SERVE</strong>
        </div>
        <div className="col-auto">
          <ValueDisplay value={value} type={type} />
        </div>
      </div>
      <ValidateValue value={value} feature={feature} />
    </div>
  );
}
