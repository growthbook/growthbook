import { FeatureInterface } from "back-end/types/feature";
import ValidateValue from "@/components/Features/ValidateValue";
import ValueDisplay from "./ValueDisplay";
import { NonExperimentCohortWarning } from "./CohortValidation";

export default function ForceSummary({
  value,
  feature,
  isDefault = false,
}: {
  value: string;
  feature: FeatureInterface;
  isDefault?: boolean;
}) {
  return (
    <>
      <NonExperimentCohortWarning value={value} />
      <div className="row align-items-top">
        <div className="col-auto">
          <strong>SERVE</strong>
        </div>
        <div className="col">
          <ValueDisplay
            value={value}
            type={feature.valueType}
            defaultVal={isDefault ? "" : feature.defaultValue}
          />
        </div>
      </div>
      <ValidateValue value={value} feature={feature} />
    </>
  );
}
