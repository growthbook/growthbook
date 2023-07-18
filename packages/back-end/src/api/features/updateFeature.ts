import { UpdateFeatureResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { updateFeatureValidator } from "../../validators/openapi";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
} from "../../models/FeatureModel";
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
import { validateDefaultValueType, validateEnvKeys } from "./postFeature";

export const updateFeature = createApiRequestHandler(updateFeatureValidator)(
  async (req): Promise<UpdateFeatureResponse> => {
    const feature = await getFeature(req.organization.id, req.params.id);
    if (!feature) {
      throw new Error(`Feature id '${req.params.id}' not found.`);
    }

    const { owner, archived, description, project, tags } = req.body;

    req.checkPermissions("manageFeatures", [
      feature.project ?? "",
      project ?? "",
    ]);

    if (project != null) {
      req.checkPermissions(
        "publishFeatures",
        feature.project,
        getEnabledEnvironments(feature)
      );
      req.checkPermissions(
        "publishFeatures",
        project,
        getEnabledEnvironments(feature)
      );
    }

    const orgEnvs = req.organization.settings?.environments || [];

    // ensure environment keys are valid
    if (req.body.environments != null) {
      validateEnvKeys(
        orgEnvs.map((e) => e.id),
        Object.keys(req.body.environments ?? {})
      );
    }

    // ensure default value matches value type
    if (req.body.defaultValue != null) {
      validateDefaultValueType(feature.valueType, req.body.defaultValue);
    }

    const environmentSettings =
      req.body.environments != null
        ? updateInterfaceEnvSettingsFromApiEnvSettings(
            feature.environmentSettings,
            req.body.environments
          )
        : null;

    const defaultValue =
      feature.valueType === "json" && typeof req.body.defaultValue === "object"
        ? JSON.stringify(req.body.defaultValue)
        : req.body.defaultValue ?? null;

    const updates: Partial<FeatureInterface> = {
      ...(owner != null ? { owner } : {}),
      ...(archived != null ? { archived } : {}),
      ...(description != null ? { description } : {}),
      ...(project != null ? { project } : {}),
      ...(tags != null ? { tags } : {}),
      ...(defaultValue != null ? { defaultValue } : {}),
      ...(environmentSettings != null ? { environmentSettings } : {}),
    };

    if (updates.environmentSettings) {
      req.checkPermissions(
        "publishFeatures",
        updates.project,
        getEnabledEnvironments({
          ...feature,
          ...updates,
        })
      );
      addIdsToRules(updates.environmentSettings, feature.id);
    }

    const updatedFeature = await updateFeatureToDb(
      req.organization,
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

    return {
      feature: getApiFeatureObj(updatedFeature, req.organization, groupMap),
    };
  }
);
