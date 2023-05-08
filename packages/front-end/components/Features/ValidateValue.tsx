import { FeatureInterface } from "back-end/types/feature";
import { useMemo } from "react";
import { FaCheck } from "react-icons/fa";
import { BsExclamationTriangleFill } from "react-icons/bs";
import { validateJSONFeatureValue } from "@/services/features";

export default function ValidateValue({
  value,
  feature,
  className,
}: {
  value: string;
  feature: FeatureInterface;
  className?: string;
}) {
  const { valid, enabled, errors } = useMemo(() => {
    const type = feature?.valueType;
    if (type === "boolean" || type === "number" || type === "string")
      return { valid: true, enabled: false, errors: [] };
    return validateJSONFeatureValue(value, feature);
  }, [value, feature]);
  if (!enabled) return null;
  if (valid) {
    return (
      <div
        className={`text-success mt-2 ${className}`}
        title="This value has been validated against the JSON schema provided"
      >
        <FaCheck className=" mr-2" title="Value is valid" /> Validated value
      </div>
    );
  }
  return (
    <div className={`text-danger border border-danger p-2 mt-2 ${className}`}>
      <BsExclamationTriangleFill /> Value fails validation with JSON schema
      <ul className="mb-0">
        {errors?.map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
      </ul>
    </div>
  );
}
