import cronParser from "cron-parser";
import {
  AGREEMENT_TYPE_AI,
  AI_AGREEMENT_VERSION,
  putSettingsValidator,
} from "shared/validators";
import { PRESET_DECISION_CRITERIAS } from "shared/enterprise";
import { AI_MODEL_SETTINGS, getProviderForAIModel } from "shared/ai";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { updateOrganizationSettings } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  assertCanUpdateOrgSettings,
  validateOrgSettingsUpdate,
} from "back-end/src/services/orgSettings";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { toApiSettings } from "./getSettings";

export const putSettings = createApiRequestHandler(putSettingsValidator)(async (
  req,
) => {
  const { context } = req;
  const org = context.org;
  const { acceptAiTerms, ...body } = req.body;

  // `null` resets a field, which still needs permission for that field.
  assertCanUpdateOrgSettings(context, body);

  // A reset stays in `changes` as undefined so validation sees it.
  const changes: Partial<OrganizationSettings> = {};
  const set: Partial<OrganizationSettings> = {};
  const unset: (keyof OrganizationSettings)[] = [];
  const settings: OrganizationSettings = { ...org.settings };
  Object.entries(body).forEach(([key, value]) => {
    const k = key as keyof OrganizationSettings;
    if (value === null) {
      delete settings[k];
      unset.push(k);
      Object.assign(changes, { [k]: undefined });
    } else if (value !== undefined) {
      Object.assign(set, { [k]: value });
      Object.assign(changes, { [k]: value });
      Object.assign(settings, { [k]: value });
    }
  });

  validateOrgSettingsUpdate(context, changes);

  if (changes.updateSchedule?.type === "cron") {
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

  // Cloud orgs accept the AI terms once, the first time AI is turned on.
  const needsAiAgreement =
    IS_CLOUD &&
    !!changes.aiEnabled &&
    !org.settings?.aiEnabled &&
    !(await context.models.agreements.getAgreementForOrg(AGREEMENT_TYPE_AI));
  if (needsAiAgreement && !acceptAiTerms) {
    throw new Error(
      "Enabling AI requires accepting the AI terms (https://docs.growthbook.io/integrations/ai). Set `acceptAiTerms: true` to accept them on behalf of the organization.",
    );
  }

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

  if (needsAiAgreement) {
    await context.models.agreements.create({
      agreement: AGREEMENT_TYPE_AI,
      version: AI_AGREEMENT_VERSION,
      userId: context.userId,
      userName: context.userName,
      userEmail: context.email,
      dateSigned: new Date(),
    });
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

  const updated: OrganizationInterface = { ...org, settings };
  return { settings: toApiSettings(updated) };
});

function pickKeys(settings: OrganizationSettings, keys: string[]) {
  return Object.fromEntries(
    keys.map((k) => [k, settings[k as keyof OrganizationSettings]]),
  );
}
