import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";

export type CohortValidation =
  | { valid: true }
  | { valid: false; reason: "not-json" }
  | { valid: false; reason: "missing-cohort" }
  | { valid: false; reason: "invalid-cohort-format" };

export function validateCohort(value: string): CohortValidation {
  try {
    const parsed = JSON.parse(value);

    // Check 1: Must be an object
    if (typeof parsed !== "object" || parsed === null) {
      return { valid: false, reason: "not-json" };
    }

    // Check 2: Must have cohort key
    if (!("cohort" in parsed)) {
      return { valid: false, reason: "missing-cohort" };
    }

    // Check 3: Cohort value must match format exp1:<somestr>:<somestr>
    const cohortValue = parsed.cohort;
    if (typeof cohortValue !== "string") {
      return { valid: false, reason: "invalid-cohort-format" };
    }

    const cohortPattern = /^exp1:[^:]+:[^:]+$/;
    if (!cohortPattern.test(cohortValue)) {
      return { valid: false, reason: "invalid-cohort-format" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "not-json" };
  }
}

export function CohortValidationWarning({
  validation,
  variationIndex,
}: {
  validation: CohortValidation;
  variationIndex: number;
}) {
  if (validation.valid) return null;

  return (
    <tr>
      <td colSpan={4}>
        <div
          className="alert alert-warning mb-0"
          style={{ fontSize: "0.9em", padding: "0.5rem" }}
        >
          <FaExclamationTriangle className="mr-1" />
          {validation.reason === "not-json" ? (
            <>
              Invalid experiment setup. Variation {variationIndex} does not have
              a json payload.
            </>
          ) : validation.reason === "missing-cohort" ? (
            <>
              Invalid experiment setup. Variation {variationIndex} does not have
              a <code>cohort</code> key.
            </>
          ) : (
            <>
              Invalid experiment setup. Variation {variationIndex} has an
              invalid cohort format. Please follow the experiment naming format:{" "}
              <code>
                exp1:&lt;experimentNameInCamelCaseYYMMDD&gt;:&lt;variantName&gt;
              </code>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export function hasExperimentFormatCohort(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return false;
    }
    if (!("cohort" in parsed)) {
      return false;
    }

    const cohortValue = parsed.cohort;
    if (typeof cohortValue !== "string") {
      return false;
    }

    const cohortPattern = /^exp1:[^:]+:[^:]+$/;
    return cohortPattern.test(cohortValue);
  } catch {
    return false;
  }
}

export function NonExperimentCohortWarning({ value }: { value: string }) {
  if (!hasExperimentFormatCohort(value)) return null;

  return (
    <div
      className="alert alert-warning"
      style={{ fontSize: "0.9em", padding: "0.5rem" }}
    >
      <FaExclamationTriangle className="mr-1" />
      Experiment naming format detected in non-experiment rule. Please rename so
      it is not picked up by our experimentation infrastructure.
    </div>
  );
}
