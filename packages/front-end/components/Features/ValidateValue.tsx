import { FeatureInterface } from "back-end/types/feature";
import React, { useMemo } from "react";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import { validateJSONFeatureValue } from "@/services/features";
import { useUser } from "@/services/UserContext";

export default function ValidateValue({
  value,
  feature,
  className = "",
  showIfValid = false,
}: {
  value: string;
  feature: FeatureInterface;
  className?: string;
  showIfValid?: boolean;
}) {
  const { hasCommercialFeature } = useUser();
  const hasJsonValidator = hasCommercialFeature("json-validation");
  const { valid, enabled, errors } = useMemo(() => {
    const type = feature?.valueType;
    if (
      type === "boolean" ||
      type === "number" ||
      type === "string" ||
      !hasJsonValidator
    )
      return { valid: true, enabled: false, errors: [] };
    return validateJSONFeatureValue(value, feature);
  }, [value, feature, hasJsonValidator]);
  if (!enabled) return null;
  if (valid) {
    if (!showIfValid) return null;
    return (
      <div
        className={`text-success ${className}`}
        title="This value has been validated against the JSON schema provided"
      >
        <FaCheck className=" mr-2" title="Value is valid" />
      </div>
    );
  }
  return (
    <div className={`alert-danger rounded p-2 mt-2 ${className}`}>
      <FaExclamationTriangle className="text-danger" /> Value fails validation
      with JSON schema
      <ul className="mb-0">
        {errors?.map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
      </ul>
    </div>
  );
}
