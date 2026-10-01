import useOrgSettings from "@/hooks/useOrgSettings";

// Field props for a user-entered tracking key when the org enforces a key format
export default function useExperimentKeyFieldProps(
  value: string | undefined,
  exempt = false,
) {
  const { experimentKeyRegexValidator: pattern, experimentKeyExample } =
    useOrgSettings();
  if (!pattern || exempt) return {};

  let matches = true;
  try {
    matches = !value || new RegExp(pattern).test(value);
  } catch {
    // An invalid stored pattern is reported by the server on submit
  }
  return {
    required: true,
    markRequired: true,
    placeholder: experimentKeyExample,
    error: matches
      ? undefined
      : `Must match your organization's key format, e.g. "${experimentKeyExample ?? ""}"`,
  };
}
