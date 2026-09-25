import { accountFeatures, CommercialFeature } from "shared/enterprise";
import { getDefaultRole } from "shared/permissions";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/constants";
import {
  MemberRoleWithProjects,
  OrganizationSettings,
} from "shared/types/organization";
import { ReqContext } from "back-end/types/request";
import { getAccountPlan } from "back-end/src/enterprise";
import { validatePriorSettings } from "back-end/src/util/priors";
import {
  assertMemberRoleInfoValid,
  assertRoleChangeAllowed,
} from "./organizations";

// Toggles whose "on" state is a paid feature. All default to off.
const PREMIUM_TOGGLES: [keyof OrganizationSettings, CommercialFeature][] = [
  ["useStickyBucketing", "sticky-bucketing"],
  ["regressionAdjustmentEnabled", "regression-adjustment"],
  ["sequentialTestingEnabled", "sequential-testing"],
  ["decisionFrameworkEnabled", "decision-framework"],
  ["requireExperimentTemplates", "templates"],
  ["codeReferencesEnabled", "code-references"],
  ["requireProjectForFeatures", "require-project-for-features-setting"],
  [
    "requireProjectForSdkConnections",
    "require-project-for-sdk-connections-setting",
  ],
];

const CUSTOM_MARKDOWN_KEYS = [
  "featureListMarkdown",
  "featurePageMarkdown",
  "experimentListMarkdown",
  "experimentPageMarkdown",
  "metricListMarkdown",
  "metricPageMarkdown",
] as const;

// Keys that must go through their own endpoints.
const DEDICATED_ENDPOINT_KEYS: Partial<
  Record<keyof OrganizationSettings, string>
> = {
  environments: "environments",
  attributeSchema: "attributes",
  namespaces: "namespaces",
};

export function assertCanUpdateOrgSettings(
  context: ReqContext,
  settings: Partial<Record<keyof OrganizationSettings, unknown>> & {
    defaultRole?: MemberRoleWithProjects | null;
  },
) {
  (Object.keys(settings) as (keyof OrganizationSettings)[]).forEach((k) => {
    const dedicated = DEDICATED_ENDPOINT_KEYS[k];
    if (dedicated) {
      throw new Error(
        `Not supported: update organization ${dedicated} with their own endpoints.`,
      );
    }
    if (k === "sdkInstructionsViewed" || k === "visualEditorEnabled") {
      if (
        !context.permissions.canCreateSDKConnection({
          projects: [],
          environment: "",
        })
      ) {
        context.permissions.throwPermissionError();
      }
    } else if (k === "northStar") {
      if (!context.permissions.canManageNorthStarMetric()) {
        context.permissions.throwPermissionError();
      }
    } else if (k === "defaultRole") {
      if (settings.defaultRole) {
        assertCanSetDefaultRole(context, settings.defaultRole);
      } else if (!context.permissions.canManageTeam()) {
        context.permissions.throwPermissionError();
      }
    } else if (!context.permissions.canManageOrgSettings()) {
      context.permissions.throwPermissionError();
    }
  });
}

export function assertCanSetDefaultRole(
  context: ReqContext,
  defaultRole: MemberRoleWithProjects,
) {
  const { org } = context;
  if (!accountFeatures[getAccountPlan(org)].has("sso")) {
    throw new Error(
      "Must have a commercial License Key to update the organization's default role.",
    );
  }
  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }
  // Only gate a change so an existing non-admin default keeps working
  assertRoleChangeAllowed(org, getDefaultRole(org).role, defaultRole.role);
  assertMemberRoleInfoValid(org, defaultRole);
}

/**
 * Value and plan checks for a settings update. Plan gates only refuse turning
 * something on, so an org that lost a feature can still save everything else.
 */
export function validateOrgSettingsUpdate(
  context: ReqContext,
  settings: Partial<OrganizationSettings>,
) {
  const current = context.org.settings ?? {};

  const refuse = (feature: CommercialFeature, setting: string) => {
    if (!context.hasPremiumFeature(feature)) {
      throw new Error(`Your plan does not support changing ${setting}.`);
    }
  };

  PREMIUM_TOGGLES.forEach(([key, feature]) => {
    if (settings[key] === true && !current[key]) refuse(feature, key);
  });

  if (
    settings.maxMetricSliceLevels !== undefined &&
    settings.maxMetricSliceLevels !==
      (current.maxMetricSliceLevels ?? DEFAULT_MAX_METRIC_SLICE_LEVELS)
  ) {
    refuse("metric-slices", "maxMetricSliceLevels");
  }

  CUSTOM_MARKDOWN_KEYS.forEach((key) => {
    const value = settings[key];
    if (value && value !== (current[key] ?? "")) refuse("custom-markdown", key);
  });

  if (
    settings.approvalFlows?.savedGroups?.some((sg) => sg?.required) &&
    !context.hasPremiumFeature("require-approvals")
  ) {
    throw new Error(
      "Saved Groups approval flows require the Require Approvals enterprise feature.",
    );
  }

  const keyExample = settings.featureKeyExample ?? current.featureKeyExample;
  const keyRegex =
    settings.featureRegexValidator ?? current.featureRegexValidator;
  // Stored values predate these checks; only a save that changes them re-checks.
  if (
    keyExample !== current.featureKeyExample ||
    keyRegex !== current.featureRegexValidator
  ) {
    validateFeatureKeySettings(keyExample, keyRegex);
  }

  validatePriorSettings(settings.metricDefaults?.priorSettings);

  const topValuesLookbackValue = settings.topValuesLookbackValue;
  if (
    typeof topValuesLookbackValue === "number" &&
    (!Number.isInteger(topValuesLookbackValue) ||
      topValuesLookbackValue <= 0 ||
      topValuesLookbackValue > 365)
  ) {
    throw new Error(
      "Top values lookback value must be an integer between 1 and 365",
    );
  }
}

function validateFeatureKeySettings(
  featureKeyExample: string | undefined,
  featureRegexValidator: string | undefined,
) {
  if (featureKeyExample && !/^[a-zA-Z0-9_.:|-]+$/.test(featureKeyExample)) {
    throw new Error(
      "Feature key examples can only include letters, numbers, hyphens, and underscores.",
    );
  }
  if (!featureRegexValidator) return;

  let regex: RegExp;
  try {
    regex = new RegExp(featureRegexValidator);
  } catch (e) {
    throw new Error(
      `Feature key regex validator is not a valid regular expression: ${e.message}`,
    );
  }
  if (!featureKeyExample) {
    throw new Error(
      "Feature key example must not be empty when a regex validator is defined.",
    );
  }
  if (!regex.test(featureKeyExample)) {
    throw new Error(
      `Feature key example does not match the regex validator. '${featureRegexValidator}' Example: '${featureKeyExample}'`,
    );
  }
}
