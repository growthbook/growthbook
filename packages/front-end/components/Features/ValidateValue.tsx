import { FeatureInterface } from "back-end/types/feature";
import React, { useMemo } from "react";
import { FaCheck } from "react-icons/fa";
import { validateJSONFeatureValue } from "shared/util";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";

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
    <Callout status="error" mb="2" mt="3">
      Value fails validation with JSON schema.
      <ul className="mb-0 mt-1">
        {errors?.map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
      </ul>
    </Callout>
  );
}
