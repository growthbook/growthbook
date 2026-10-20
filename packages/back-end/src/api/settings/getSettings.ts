import { isNull, omitBy, pick } from "lodash";
import { getScopedSettings } from "shared/settings";
import {
  API_READ_ONLY_SETTING_KEYS,
  API_WRITABLE_SETTING_KEYS,
  getSettingsValidator,
} from "shared/validators";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { getDefaultRole, withDefaultRoleDefaults } from "shared/permissions";
import {
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import {
  ExperimentUpdateSchedule,
  NorthStarMetric,
  OrganizationInterface,
} from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  toApiRequireReviews,
  toApiSavedGroupApprovals,
} from "./approvalRuleShapes";

export const getSettings = createApiRequestHandler(getSettingsValidator)(async (
  req,
) => {
  return {
    settings: toApiSettings(req.context.org),
  };
});

export function toApiSettings(org: OrganizationInterface) {
  const { settings: scopedSettings } = getScopedSettings({
    organization: org,
  });

  const settingsValues = extractSettingValues(scopedSettings);

  // Remove deprecated settings
  const {
    sdkInstructionsViewed: _sdk,
    videoInstructionsViewed: _video,
    ...filteredSettings
  } = settingsValues;

  // Settings with no scoped resolver are read straight off the org.
  const stored = org.settings ?? {};

  return {
    ...pick(stored, [
      ...API_WRITABLE_SETTING_KEYS,
      ...API_READ_ONLY_SETTING_KEYS,
    ]),
    requireRegisteredAttributes:
      stored.requireRegisteredAttributes !== undefined
        ? getRequireRegisteredAttributesSettings(
            stored.requireRegisteredAttributes,
          )
        : undefined,
    ...filteredSettings,
    requireReviews: Array.isArray(filteredSettings.requireReviews)
      ? toApiRequireReviews(filteredSettings.requireReviews)
      : [],
    approvalFlows: {
      savedGroups: toApiSavedGroupApprovals(
        stored.approvalFlows?.savedGroups ?? [],
      ),
    },
    // Stored values, not the effective ones the resolvers derive, so PUT can echo them.
    regressionAdjustmentDays:
      stored.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
    postStratificationEnabled:
      stored.postStratificationEnabled ?? DEFAULT_POST_STRATIFICATION_ENABLED,
    // The settings page stores these loosely; return them in the shape PUT accepts.
    pValueCorrection: filteredSettings.pValueCorrection || null,
    updateSchedule: toApiUpdateSchedule(filteredSettings.updateSchedule),
    northStar: toApiNorthStar(filteredSettings.northStar),
    metricDefaults: omitBy(filteredSettings.metricDefaults, isNull),
    defaultRole: toApiDefaultRole(org),
    experimentMaxLengthDays: filteredSettings.experimentMaxLengthDays ?? null,
    preferredEnvironment: stored.preferredEnvironment ?? null,
  };
}

// Legacy roles lack fields PUT requires, so fill them in.
export function toApiDefaultRole(org: OrganizationInterface) {
  return withDefaultRoleDefaults(getDefaultRole(org));
}

function toApiNorthStar(northStar: NorthStarMetric | null) {
  if (!northStar) return null;
  const { startDate, ...rest } = northStar;
  return startDate
    ? { ...rest, startDate: new Date(startDate).toISOString() }
    : rest;
}

// A cleared or edited hours input is stored as a string.
function toApiUpdateSchedule(schedule: ExperimentUpdateSchedule | null) {
  if (!schedule) return null;
  const { hours, ...rest } = schedule;
  const value = Number(hours);
  return value > 0 ? { ...rest, hours: value } : rest;
}

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
