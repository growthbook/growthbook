import { getScopedSettings } from "shared/settings";
import { getSettingsValidator } from "shared/validators";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";

// Return only the documented fields, so what a caller reads is what
// PUT /settings/approvals will accept back. Orgs carry settings written by
// older versions, and an undeclared key would fail that round-trip.
const toApiRequireReviewRule = (rule: RequireReview) => ({
  requireReviewOn: rule.requireReviewOn,
  projects: rule.projects,
  resetReviewOnChange: rule.resetReviewOnChange,
  environments: rule.environments,
  featureRequireEnvironmentReview: rule.featureRequireEnvironmentReview,
  featureRequireMetadataReview: rule.featureRequireMetadataReview,
  blockSelfApproval: rule.blockSelfApproval,
  autopublishOnApproval: rule.autopublishOnApproval,
  requiredApproverTeams: rule.requiredApproverTeams,
});

const toApiSavedGroupApprovalRule = (rule: ApprovalFlowConfiguration) => ({
  required: rule.required,
  projects: rule.projects,
  resetReviewOnChange: rule.resetReviewOnChange,
  requireMetadataReview: rule.requireMetadataReview,
  blockSelfApproval: rule.blockSelfApproval,
  autopublishOnApproval: rule.autopublishOnApproval,
  requiredApproverTeams: rule.requiredApproverTeams,
});

// Absence is the unset form, so drop the keys that carry nothing.
const omitUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;

export const getSettings = createApiRequestHandler(getSettingsValidator)(async (
  req,
) => {
  const { settings: scopedSettings } = getScopedSettings({
    organization: req.context.org,
  });

  const settingsValues = extractSettingValues(scopedSettings);

  // Remove deprecated settings
  const {
    sdkInstructionsViewed: _sdk,
    videoInstructionsViewed: _video,
    ...filteredSettings
  } = settingsValues;

  const settings = {
    ...filteredSettings,
    requireReviews: Array.isArray(filteredSettings.requireReviews)
      ? filteredSettings.requireReviews.map((rule) =>
          omitUndefined(toApiRequireReviewRule(rule)),
        )
      : [],
    // Not a scoped setting, so read it straight off the org.
    approvalFlows: {
      savedGroups: (
        req.context.org.settings?.approvalFlows?.savedGroups ?? []
      ).map((rule) => omitUndefined(toApiSavedGroupApprovalRule(rule))),
    },
    experimentMaxLengthDays: filteredSettings.experimentMaxLengthDays ?? null,
    preferredEnvironment:
      req.context.org.settings?.preferredEnvironment ?? null,
  };

  return {
    settings,
  };
});

/**
 * Extracts the 'value' property from each Setting<T> in the provided object
 *
 */
function extractSettingValues<T extends Record<string, { value: unknown }>>(
  scopedSettings: T,
): { [K in keyof T]: T[K]["value"] } {
  return Object.fromEntries(
    Object.entries(scopedSettings).map(([key, setting]) => [
      key,
      setting.value,
    ]),
  ) as { [K in keyof T]: T[K]["value"] };
}
