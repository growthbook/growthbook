import { FeatureInterface } from "back-end/types/feature";
import ValidateValue from "@front-end/components/Features/ValidateValue";
import ValueDisplay from "./ValueDisplay";

export default function ForceSummary({
  value,
  feature,
}: {
  value: string;
  feature: FeatureInterface;
}) {
  return (
    <>
      <div className="row align-items-top">
        <div className="col-auto">
          <strong>SERVE</strong>
        </div>
        <div className="col">
          <ValueDisplay value={value} type={feature.valueType} />
        </div>
      </div>
      <ValidateValue value={value} feature={feature} />
    </>
  );
}
