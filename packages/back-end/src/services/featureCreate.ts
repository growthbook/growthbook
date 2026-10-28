import { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { AuditInterfaceInput } from "shared/types/audit";
import {
  filterEnvironmentsByFeature,
  normalizeTargetingProjects,
} from "shared/util";
import {
  FEATURE_KEY_PATTERN,
  FEATURE_KEY_PATTERN_ERROR,
} from "shared/constants";
import { ReqContext } from "back-end/types/request";
import { assertValidHoldout } from "back-end/src/api/features/v2Shared";
import {
  assertValidFeatureRules,
  validatePrerequisiteConditions,
} from "back-end/src/api/features/validations";
import { createFeature, getFeature } from "back-end/src/models/FeatureModel";
import { normalizeRulesInputToV2 } from "back-end/src/models/FeatureRevisionModel";
import { assertCanCreateFeatureInState } from "back-end/src/revisions/featureDraftAuthority";
import { auditDetailsCreate } from "back-end/src/services/audit";
import {
  addIdsToFlatRules,
  addIdsToRules,
  assertFeatureValuesValid,
} from "back-end/src/services/features";
import { assertValidPrerequisiteParents } from "back-end/src/services/prerequisiteParents";
import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import { getInitialFeatureJsonSchema } from "back-end/src/util/feature-json-schema";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/util/organization.util";

export type NewFeatureInput = Partial<FeatureInterface> & {
  duplicateOf?: string;
};

// Every check a new flag passes, and the flag they build; writes nothing, so a
// caller can check it before writing anything else.
export async function prepareNewFeature(
  context: ReqContext,
  input: NewFeatureInput,
): Promise<FeatureInterface> {
  const { org, userId } = context;
  const {
    id,
    environmentSettings,
    holdout,
    customFields,
    jsonSchema,
    duplicateOf,
    ...otherProps
  } = input;

  if (
    !context.permissions.canCreateFeature(
      input,
      Array.from(
        getEnabledEnvironments(
          input as FeatureInterface,
          getEnvironmentIdsFromOrg(context.org),
        ),
      ),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  if (typeof id !== "string" || !id) {
    throw new Error("Must specify feature key");
  }

  if (org.settings?.featureRegexValidator) {
    const regex = new RegExp(org.settings.featureRegexValidator);
    if (!regex.test(id)) {
      throw new Error(
        `Feature key must match the regex validator. '${org.settings.featureRegexValidator}' Example: '${org.settings.featureKeyExample}'`,
      );
    }
  }

  if (!environmentSettings) {
    throw new Error("Feature missing initial environment toggle settings");
  }

  if (!new RegExp(FEATURE_KEY_PATTERN).test(id)) {
    throw new Error(FEATURE_KEY_PATTERN_ERROR);
  }

  if (org.settings?.requireProjectForFeatures && !otherProps.project) {
    throw new Error("Must specify a project for new features");
  }
  // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
  if (otherProps.project) {
    await context.models.projects.ensureProjectsExist([otherProps.project]);
  }
  // Read-gated, so a caller can't link a flag into a Holdout outside their scope.
  // The linkage write itself deliberately bypasses read scope, so this is the
  // only place the id is authorized.
  await assertValidHoldout(
    holdout?.id ? holdout : null,
    context,
    otherProps.project ?? "",
  );

  await validateCustomFieldsForSection({
    customFieldValues: customFields,
    customFieldsModel: context.models.customFields,
    section: "feature",
    project: otherProps.project || undefined,
  });

  const existing = await getFeature(context, id);
  if (existing) {
    throw new Error(
      "This feature key already exists. Feature keys must be unique.",
    );
  }

  const initialJsonSchema = getInitialFeatureJsonSchema(jsonSchema);

  const feature: FeatureInterface = {
    defaultValue: "",
    valueType: "boolean",
    owner: userId,
    description: "",
    project: "",
    environmentSettings: {},
    rules: [],
    customFields,
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id,
    archived: false,
    version: 1,
    holdout: holdout?.id ? holdout : undefined,
    jsonSchema: initialJsonSchema,
  };
  Object.assign(feature, normalizeTargetingProjects(feature));

  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  // construct environmentSettings, scrub environments if not allowed in project
  feature.environmentSettings = Object.fromEntries(
    Object.entries(environmentSettings).filter(([env]) =>
      environmentIds.includes(env),
    ),
  );

  await assertCanCreateFeatureInState({ context, feature, environmentIds });
  // After the gate so an unreadable id cannot be probed for existence.
  if (feature.targetingProjects?.length) {
    await context.models.projects.ensureProjectIdsExist(
      feature.targetingProjects,
    );
  }

  addIdsToRules(feature.environmentSettings, feature.id);

  // Accept v1-shape (env-nested rules) or v2-shape (top-level `rules`) bodies,
  // but never both — mixing silently concats into feature.rules and can
  // corrupt rule ids. buildFeatureUpdate strips stray envSettings[env].rules
  // on write.
  const inboundEnvRules = Object.fromEntries(
    Object.entries(feature.environmentSettings ?? {}).map(([env, settings]) => [
      env,
      ((settings as unknown as { rules?: FeatureRule[] }).rules ??
        []) as FeatureRule[],
    ]),
  );
  const hasTopLevelRules = Array.isArray(otherProps.rules)
    ? otherProps.rules.length > 0
    : false;
  const hasPerEnvRules = Object.values(inboundEnvRules).some(
    (r) => Array.isArray(r) && r.length > 0,
  );
  if (hasTopLevelRules && hasPerEnvRules) {
    throw new Error(
      "Feature create received both top-level `rules` and `environmentSettings[env].rules`. " +
        "Use one shape or the other — the v1 per-env shape is for v1 clients; the v2 flat `rules` array is for v2 clients.",
    );
  }
  // v1-shape (per-env) input is normalized through `normalizeRulesInputToV2`
  // so content-identical rules across envs merge into a single v2 rule with
  // `environments: [...envs]` (or `allEnvironments: true` when applicable),
  // matching the read-path JIT migration. The naive shared `naiveFlattenV1Rules`
  // would split the same rule id across envs, forcing `ensureUniqueRuleIds`
  // to suffix and breaking v1 round-trip semantics.
  const flattenedInbound = normalizeRulesInputToV2(inboundEnvRules, {
    orgEnvs: getEnvironments(org),
    featureProject: feature.project,
  });
  if (flattenedInbound.length > 0) {
    feature.rules = [...(feature.rules ?? []), ...flattenedInbound];
  }

  // Inbound v2 rules (e.g. from FeatureFromExperimentModal) often arrive with
  // `id: ""`; stamp ids so they're addressable by later update/delete ops.
  addIdsToFlatRules(feature.rules, feature.id);
  // A duplicate echoes its source's rules; only what the copy changes is
  // re-checked.
  const source = duplicateOf ? await getFeature(context, duplicateOf) : null;
  await assertValidFeatureRules(context, feature.rules ?? [], source?.rules, {
    copiesRules: true,
  });
  validatePrerequisiteConditions(feature.prerequisites ?? []);
  await assertValidPrerequisiteParents(context, feature, source ?? undefined);
  assertFeatureValuesValid(context, feature, {
    defaultValue: feature.defaultValue,
    rules: feature.rules,
  });

  return feature;
}

export async function insertNewFeature(
  context: ReqContext,
  feature: FeatureInterface,
  audit: (data: AuditInterfaceInput) => Promise<void>,
): Promise<void> {
  await createFeature(context, feature);
  await context.models.watch.upsertWatch({
    userId: context.userId,
    item: feature.id,
    type: "features",
  });

  await audit({
    event: "feature.create",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsCreate(feature),
  });

  if (feature.holdout?.id) {
    await context.models.holdout.addFeatureToHoldout(
      feature.holdout.id,
      feature.id,
    );
  }
}
