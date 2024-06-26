import { featureRequiresReview, validateFeatureValue } from "shared/util";
import { isEqual } from "lodash";
import { UpdateFeatureResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { updateFeatureValidator } from "../../validators/openapi";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
} from "../../models/FeatureModel";
import { getExperimentMapForFeature } from "../../models/ExperimentModel";
import {
  addIdsToRules,
  getApiFeatureObj,
  getSavedGroupMap,
  updateInterfaceEnvSettingsFromApiEnvSettings,
} from "../../services/features";
import { FeatureInterface } from "../../../types/feature";
import { getEnabledEnvironments } from "../../util/features";
import { addTagsDiff } from "../../models/TagModel";
import { auditDetailsUpdate } from "../../services/audit";
import { createRevision, getRevision } from "../../models/FeatureRevisionModel";
import { FeatureRevisionInterface } from "../../../types/feature-revision";
import { getEnvironmentIdsFromOrg } from "../../services/organizations";
import { parseJsonSchemaForEnterprise, validateEnvKeys } from "./postFeature";

export const updateFeature = createApiRequestHandler(updateFeatureValidator)(
  async (req): Promise<UpdateFeatureResponse> => {
    const feature = await getFeature(req.context, req.params.id);
    if (!feature) {
      throw new Error(`Feature id '${req.params.id}' not found.`);
    }

    const { owner, archived, description, project, tags } = req.body;

    const orgEnvs = getEnvironmentIdsFromOrg(req.organization);

    if (!req.context.permissions.canUpdateFeature(feature, req.body)) {
      req.context.permissions.throwPermissionError();
    }

    if (project != null) {
      if (
        !req.context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, orgEnvs))
        ) ||
        !req.context.permissions.canPublishFeature(
          { project },
          Array.from(getEnabledEnvironments(feature, orgEnvs))
        )
      ) {
        req.context.permissions.throwPermissionError();
      }
    }

    // ensure environment keys are valid
    if (req.body.environments != null) {
      validateEnvKeys(orgEnvs, Object.keys(req.body.environments ?? {}));
    }

    // ensure default value matches value type
    let defaultValue;
    if (req.body.defaultValue != null) {
      defaultValue = validateFeatureValue(feature, req.body.defaultValue);
    }

    const environmentSettings =
      req.body.environments != null
        ? updateInterfaceEnvSettingsFromApiEnvSettings(
            feature,
            req.body.environments
          )
        : null;

    const jsonSchema =
      feature.valueType === "json" && req.body.jsonSchema != null
        ? parseJsonSchemaForEnterprise(req.organization, req.body.jsonSchema)
        : null;

    const updates: Partial<FeatureInterface> = {
      ...(owner != null ? { owner } : {}),
      ...(archived != null ? { archived } : {}),
      ...(description != null ? { description } : {}),
      ...(project != null ? { project } : {}),
      ...(tags != null ? { tags } : {}),
      ...(defaultValue != null ? { defaultValue } : {}),
      ...(environmentSettings != null ? { environmentSettings } : {}),
      ...(jsonSchema != null ? { jsonSchema } : {}),
    };

    if (
      updates.environmentSettings ||
      updates.defaultValue != null ||
      updates.project != null ||
      updates.archived != null
    ) {
      if (
        !req.context.permissions.canPublishFeature(
          updates,
          Array.from(
            getEnabledEnvironments(
              {
                ...feature,
                ...updates,
              },
              orgEnvs
            )
          )
        )
      ) {
        req.context.permissions.throwPermissionError();
      }
      addIdsToRules(updates.environmentSettings, feature.id);
    }

    // Create a revision for the changes and publish them immediately
    let defaultValueChanged = false;
    const changedEnvironments: string[] = [];
    if ("defaultValue" in updates || "environmentSettings" in updates) {
      const revisionChanges: Partial<FeatureRevisionInterface> = {};

      let hasChanges = false;
      if (
        "defaultValue" in updates &&
        updates.defaultValue !== feature.defaultValue
      ) {
        revisionChanges.defaultValue = updates.defaultValue;
        hasChanges = true;
        defaultValueChanged = true;
      }
      if (updates.environmentSettings) {
        Object.entries(updates.environmentSettings).forEach(
          ([env, settings]) => {
            if (
              !isEqual(
                settings.rules,
                feature.environmentSettings?.[env]?.rules || []
              )
            ) {
              hasChanges = true;
              changedEnvironments.push(env);
              revisionChanges.rules = revisionChanges.rules || {};
              revisionChanges.rules[env] = settings.rules;
            }
          }
        );
      }

      if (hasChanges) {
        const reviewRequired = featureRequiresReview(
          feature,
          changedEnvironments,
          defaultValueChanged,
          req.organization.settings
        );
        if (reviewRequired) {
          if (!req.context.permissions.canBypassApprovalChecks(feature)) {
            throw new Error(
              "This feature requires a review and the API key being used does not have permission to bypass reviews."
            );
          }
        }

        const revision = await createRevision({
          feature,
          user: req.eventAudit,
          baseVersion: feature.version,
          comment: "Created via REST API",
          environments: orgEnvs,
          publish: true,
          changes: revisionChanges,
          org: req.organization,
          canBypassApprovalChecks: true,
        });
        updates.version = revision.version;
      }
    }

    const updatedFeature = await updateFeatureToDb(
      req.context,
      feature,
      updates
    );

    await addTagsDiff(
      req.organization.id,
      feature.tags || [],
      updates.tags || []
    );

    await req.audit({
      event: "feature.update",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updatedFeature),
    });

    const groupMap = await getSavedGroupMap(req.organization);

    const experimentMap = await getExperimentMapForFeature(
      req.context,
      feature.id
    );
    const revision = await getRevision(
      updatedFeature.organization,
      updatedFeature.id,
      updatedFeature.version
    );
    return {
      feature: getApiFeatureObj({
        feature: updatedFeature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
      }),
    };
  }
);
