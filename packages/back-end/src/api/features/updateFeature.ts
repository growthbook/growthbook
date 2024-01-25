import { validateFeatureValue } from "shared/util";
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
import { createRevision } from "../../models/FeatureRevisionModel";
import { FeatureRevisionInterface } from "../../../types/feature-revision";
import { getEnvironmentIdsFromOrg } from "../../services/organizations";
import { parseJsonSchemaForEnterprise, validateEnvKeys } from "./postFeature";

export const updateFeature = createApiRequestHandler(updateFeatureValidator)(
  async (req): Promise<UpdateFeatureResponse> => {
    const feature = await getFeature(req.organization.id, req.params.id);
    if (!feature) {
      throw new Error(`Feature id '${req.params.id}' not found.`);
    }

    const { owner, archived, description, project, tags } = req.body;

    const orgEnvs = getEnvironmentIdsFromOrg(req.organization);

    // check permissions for previous project and new one
    req.checkPermissions("manageFeatures", [
      feature.project ?? "",
      project ?? "",
    ]);

    if (project != null) {
      req.checkPermissions(
        "publishFeatures",
        feature.project,
        getEnabledEnvironments(feature, orgEnvs)
      );
      req.checkPermissions(
        "publishFeatures",
        project,
        getEnabledEnvironments(feature, orgEnvs)
      );
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
      req.checkPermissions(
        "publishFeatures",
        updates.project,
        getEnabledEnvironments(
          {
            ...feature,
            ...updates,
          },
          orgEnvs
        )
      );
      addIdsToRules(updates.environmentSettings, feature.id);
    }

    // Create a revision for the changes and publish them immediately
    if ("defaultValue" in updates || "environmentSettings" in updates) {
      const revisionChanges: Partial<FeatureRevisionInterface> = {};

      let hasChanges = false;
      if (
        "defaultValue" in updates &&
        updates.defaultValue !== feature.defaultValue
      ) {
        revisionChanges.defaultValue = updates.defaultValue;
        hasChanges = true;
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
              revisionChanges.rules = revisionChanges.rules || {};
              revisionChanges.rules[env] = settings.rules;
            }
          }
        );
      }

      if (hasChanges) {
        const revision = await createRevision({
          feature,
          user: req.eventAudit,
          baseVersion: feature.version,
          comment: "Created via REST API",
          environments: orgEnvs,
          publish: true,
          changes: revisionChanges,
        });
        updates.version = revision.version;
      }
    }

    const updatedFeature = await updateFeatureToDb(
      req.context,
      req.eventAudit,
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

    return {
      feature: getApiFeatureObj({
        feature: updatedFeature,
        organization: req.organization,
        groupMap,
        experimentMap,
      }),
    };
  }
);
