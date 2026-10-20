import cronParser from "cron-parser";
import { isEqual, omit, omitBy, pick } from "lodash";
import { getDefaultRole } from "shared/permissions";
import {
  API_ECHO_ONLY_SETTING_KEYS,
  putSettingsValidator,
} from "shared/validators";
import { PRESET_DECISION_CRITERIAS } from "shared/enterprise";
import { AI_MODEL_SETTINGS, getProviderForAIModel } from "shared/ai";
import { OrganizationSettings } from "shared/types/organization";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  findOrganizationById,
  updateOrganizationSettings,
} from "back-end/src/models/OrganizationModel";
import { getConfigOrganizationSettings } from "back-end/src/init/config";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { sanitizeDefaultRoleUpdate } from "back-end/src/services/organizations";
import {
  assertCanUpdateOrgSettings,
  validateOrgSettingsUpdate,
} from "back-end/src/services/orgSettings";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toApiDefaultRole, toApiSettings } from "./getSettings";

export const putSettings = createApiRequestHandler(putSettingsValidator)(async (
  req,
) => {
  const { context } = req;
  const org = context.org;
  const sent = req.body;

  // Read-only keys are accepted only as GET returns them, so GET can be echoed.
  const apiSettings: Record<string, unknown> = toApiSettings(org);
  API_ECHO_ONLY_SETTING_KEYS.forEach((key) => {
    if (key in sent && !isEqual(toJson(sent[key]), toJson(apiSettings[key]))) {
      throw new Error(
        `\`${key}\` is read-only on this endpoint; send it unchanged or omit it.`,
      );
    }
  });
  const requested = omit(sent, API_ECHO_ONLY_SETTING_KEYS);

  // A reset default role falls back to collaborator, so it is checked as one.
  if (requested.defaultRole === null) {
    requested.defaultRole = getDefaultRole({});
  }

  // Values echoed back unchanged from GET are dropped, so they skip every check
  // and an echoed default isn't pinned as a stored value.
  const current: Record<string, unknown> = {
    ...org.settings,
    defaultRole: toApiDefaultRole(org),
  };
  const body: Partial<typeof requested> = omitBy(
    requested,
    (v, k) =>
      isEqual(toJson(v), toJson(current[k])) ||
      (v !== null && isEqual(toJson(v), toJson(apiSettings[k]))),
  );
  if (!Object.keys(body).length) return { settings: toApiSettings(org) };

  // config.yml overlays these on every read, so a write would not take effect.
  const fileManaged = Object.keys(body).filter(
    (k) => k in getConfigOrganizationSettings(),
  );
  if (fileManaged.length) {
    throw new Error(
      `Managed by config.yml; change it there instead: ${fileManaged.join(", ")}`,
    );
  }

  // `null` resets a field, which still needs permission for that field.
  assertCanUpdateOrgSettings(context, body);
  if (body.defaultRole) {
    const role: OrganizationSettings = { defaultRole: body.defaultRole };
    await sanitizeDefaultRoleUpdate(context, role);
    body.defaultRole = role.defaultRole;
  }

  // A reset stays in `changes` as undefined so validation sees it.
  const changes: Partial<OrganizationSettings> = {};
  const set: Partial<OrganizationSettings> = {};
  const unset: (keyof OrganizationSettings)[] = [];
  const settings: OrganizationSettings = { ...org.settings };
  Object.entries(body).forEach(([key, value]) => {
    const k = key as keyof OrganizationSettings;
    if (value === null) {
      delete settings[k];
      // Reads rebuild a reset field from its stored predecessor, so clear both
      unset.push(k, ...(LEGACY_SETTING_KEYS[k] ?? []));
      Object.assign(changes, { [k]: undefined });
    } else if (value !== undefined) {
      Object.assign(set, { [k]: value });
      Object.assign(changes, { [k]: value });
      Object.assign(settings, { [k]: value });
    }
  });

  validateOrgSettingsUpdate(context, changes);

  if (
    changes.updateSchedule?.type === "cron" &&
    !isEqual(
      pick(changes.updateSchedule, ["type", "cron"]),
      pick(org.settings?.updateSchedule, ["type", "cron"]),
    )
  ) {
    try {
      cronParser.parseExpression(changes.updateSchedule.cron ?? "");
    } catch (e) {
      throw new Error(`Invalid updateSchedule.cron: ${e.message}`);
    }
  }

  AI_MODEL_SETTINGS.forEach(({ key, kind }) => {
    const model = changes[key];
    if (model && !getProviderForAIModel(kind, model)) {
      throw new Error(`Unknown ${kind} model for ${key}: ${model}`);
    }
  });

  if (
    changes.defaultDataSource &&
    !(await getDataSourceById(context, changes.defaultDataSource))
  ) {
    throw new Error(`Unknown Data Source: ${changes.defaultDataSource}`);
  }
  if (
    changes.defaultDecisionCriteriaId &&
    !PRESET_DECISION_CRITERIAS.some(
      (c) => c.id === changes.defaultDecisionCriteriaId,
    ) &&
    !(await context.models.decisionCriteria.getById(
      changes.defaultDecisionCriteriaId,
    ))
  ) {
    throw new Error(
      `Unknown decision criteria: ${changes.defaultDecisionCriteriaId}`,
    );
  }
  if (
    changes.preferredEnvironment &&
    !(settings.environments ?? []).some(
      (e) => e.id === changes.preferredEnvironment,
    )
  ) {
    throw new Error(`Unknown environment: ${changes.preferredEnvironment}`);
  }

  await updateOrganizationSettings(org.id, set, unset);

  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: org.id },
    details: auditDetailsUpdate(
      { settings: pickKeys(org.settings ?? {}, Object.keys(body)) },
      { settings: pickKeys(settings, Object.keys(body)) },
    ),
  });

  // Re-read so the response includes concurrent changes to other settings.
  const updated = (await findOrganizationById(org.id)) ?? { ...org, settings };
  return { settings: toApiSettings(updated) };
});

const LEGACY_SETTING_KEYS: Partial<
  Record<keyof OrganizationSettings, (keyof OrganizationSettings)[]>
> = {
  postStratificationEnabled: ["postStratificationDisabled"],
  visualEditorEnabled: ["implementationTypes"],
};

// Compares values the way a client saw them in the JSON response.
function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

function pickKeys(settings: OrganizationSettings, keys: string[]) {
  return Object.fromEntries(
    keys.map((k) => [k, settings[k as keyof OrganizationSettings]]),
  );
}
