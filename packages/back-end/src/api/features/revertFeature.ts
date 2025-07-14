import { filterEnvironmentsByFeature, MergeResultChanges } from "shared/util";
import { isEqual } from "lodash";
import {
  getRevision,
  markRevisionAsPublished,
} from "back-end/src/models/FeatureRevisionModel";
import { ToggleFeatureResponse } from "back-end/types/openapi";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  applyRevisionChanges,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { getEnvironments } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { revertFeatureValidator } from "back-end/src/validators/openapi";
import { getEnabledEnvironments } from "back-end/src/util/features";

export const revertFeature = createApiRequestHandler(revertFeatureValidator)(
  async (req): Promise<ToggleFeatureResponse> => {
    const context = req.context;

    const feature = await getFeature(context, req.params.id);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const allEnvironments = getEnvironments(context.org);
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const environmentIds = environments.map((e) => e.id);

    if (!req.context.permissions.canUpdateFeature(feature, {})) {
      req.context.permissions.throwPermissionError();
    }

    const { revision: version, comment } = req.body;

    const revision = await getRevision({
      context,
      organization: context.org.id,
      featureId: feature.id,
      version: version,
    });
    if (!revision) {
      throw new Error("Could not find feature revision");
    }

    if (
      revision.version === feature.version ||
      revision.status !== "published"
    ) {
      throw new Error("Can only revert to previously published revisions");
    }

    const changes: MergeResultChanges = {};

    if (revision.defaultValue !== feature.defaultValue) {
      if (
        !context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, environmentIds))
        )
      ) {
        context.permissions.throwPermissionError();
      }
      changes.defaultValue = revision.defaultValue;
    }

    const changedEnvs: string[] = [];
    environmentIds.forEach((env) => {
      if (
        revision.rules[env] &&
        !isEqual(
          revision.rules[env],
          feature.environmentSettings?.[env]?.rules || []
        )
      ) {
        changedEnvs.push(env);
        changes.rules = changes.rules || {};
        changes.rules[env] = revision.rules[env];
      }
    });
    if (changedEnvs.length > 0) {
      if (!context.permissions.canPublishFeature(feature, changedEnvs)) {
        context.permissions.throwPermissionError();
      }
    }

    const updatedFeature = await applyRevisionChanges(
      context,
      feature,
      revision,
      changes
    );

    await markRevisionAsPublished(context, revision, req.eventAudit, comment);

    await req.audit({
      event: "feature.revert",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updatedFeature, {
        revision: revision.version,
      }),
    });

    const groupMap = await getSavedGroupMap(req.organization);
    const experimentMap = await getExperimentMapForFeature(
      req.context,
      feature.id
    );
    const safeRolloutMap = await req.context.models.safeRollout.getAllPayloadSafeRollouts();

    return {
      feature: getApiFeatureObj({
        feature: updatedFeature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
        safeRolloutMap,
      }),
    };
  }
);
