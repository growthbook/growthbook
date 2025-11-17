import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";

export type CohortValidation =
  | { valid: true }
  | { valid: false; reason: "not-json" }
  | { valid: false; reason: "missing-cohort" }
  | { valid: false; reason: "invalid-cohort-format" }
  | { valid: false; reason: "cohort-trailing-space" };

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

    if (cohortValue.trim() !== cohortValue) {
      return { valid: false, reason: "cohort-trailing-space" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "not-json" };
  }
}

export function CohortValidationWarning({ value }: { value: string }) {
  const validation = validateCohort(value);
  if (validation.valid) return null;

  return (
    <div
      className="alert alert-warning mb-0 mt-2"
      style={{ fontSize: "0.9em", padding: "0.5rem" }}
    >
      <FaExclamationTriangle className="mr-1" />
      {validation.reason === "not-json" ? (
        <>Invalid experiment setup. Variation does not have a json payload.</>
      ) : validation.reason === "missing-cohort" ? (
        <>
          Invalid experiment setup. Variation does not have a{" "}
          <code>cohort</code> key.
        </>
      ) : validation.reason === "cohort-trailing-space" ? (
        <>
          Invalid experiment setup. Variation has trailing whitespace in the
          cohort value. Please remove any spaces before or after the value.
        </>
      ) : (
        <>
          Invalid experiment setup. Variation has an invalid cohort value.
          Please follow the experiment naming format:{" "}
          <code>
            exp1:&lt;experimentNameInCamelCaseYYMMDD&gt;:&lt;variantName&gt;
          </code>
        </>
      )}
    </div>
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
    if (!cohortPattern.test(cohortValue)) {
      return false;
    }
    return cohortValue.trim() === cohortValue;
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
