import { FeatureValueType } from "back-end/types/feature";
import ValueDisplay from "./ValueDisplay";

export default function ForceSummary({
  value,
  type,
}: {
  value: string;
  type: FeatureValueType;
}) {
  return (
    <div className="row align-items-top">
      <div className="col-auto">
        <strong>SERVE</strong>
      </div>
      <div className="col">
        <ValueDisplay value={value} type={type} />
      </div>
    </div>
  );
}
