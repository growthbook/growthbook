import { groupBy, values } from "lodash";
import { postCodeRefsValidator } from "shared/validators";
import { promiseAllChunks } from "back-end/src/util/promise";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getExistingFeaturesForRepoBranch,
  getFeatureKeysForRepoBranch,
  upsertFeatureCodeRefs,
} from "back-end/src/models/FeatureCodeRefs";
import { getFeatureProjectsByIds } from "back-end/src/models/FeatureModel";

export const postCodeRefs = createApiRequestHandler(postCodeRefsValidator)(
  async (req) => {
    const { deleteMissing: deleteMissingString } = req.query;
    const { branch, repoName: repo } = req.body;
    const refsByFeature = groupBy(req.body.refs, "flagKey");
    // convert deleteMissing to boolean
    const deleteMissing = deleteMissingString === "true";

    const existingFeatures = await getExistingFeaturesForRepoBranch({
      repo,
      branch,
      organization: req.context.org,
    });

    const requestedFeatures = new Set(Object.keys(refsByFeature));

    let featuresToRemove: string[] = [];

    if (deleteMissing) {
      featuresToRemove = existingFeatures.filter(
        (feature) => !requestedFeatures.has(feature),
      );
    }

    // Require write access to every feature being upserted or cleared before
    // touching the collection. Code ref flag keys equal feature ids. Resolve the
    // project of each existing feature (regardless of the caller's read access)
    // so a feature in a project the caller can't reach is still checked against
    // that project — not silently treated as a non-existent key.
    const affectedFeatureIds = [
      ...new Set([...requestedFeatures, ...featuresToRemove]),
    ];
    const featureProjects = await getFeatureProjectsByIds(
      req.context,
      affectedFeatureIds,
    );
    const cannotWriteAll = affectedFeatureIds.some((featureId) => {
      if (featureProjects.has(featureId)) {
        // Existing feature: require write access to its project.
        const project = featureProjects.get(featureId);
        return !req.context.permissions.canUpdateFeature(
          { project },
          { project },
        );
      }
      // No matching feature in the org. When upserting, this is a flag key with
      // no GrowthBook feature, gated on a global manageFeatures check. When only
      // clearing (deleteMissing), the feature was deleted and we're just removing
      // its dangling refs — there's no project to gate on, so allow it.
      if (requestedFeatures.has(featureId)) {
        return !req.context.permissions.canCreateFeature({});
      }
      return false;
    });
    if (cannotWriteAll) {
      req.context.permissions.throwPermissionError();
    }

    if (deleteMissing) {
      // Remove references for features not in the request by setting empty refs
      await promiseAllChunks(
        featuresToRemove.map(
          (feature) => async () => {
            await upsertFeatureCodeRefs({
              feature,
              repo,
              branch,
              codeRefs: [], // Empty array will replace all existing refs
              organization: req.context.org,
            });
          },
          5,
        ),
      );
    }

    // Update references for features in the request
    await promiseAllChunks(
      values(refsByFeature).map(
        (refs) => async () => {
          await upsertFeatureCodeRefs({
            feature: refs[0].flagKey,
            repo,
            branch,
            codeRefs: refs,
            organization: req.context.org,
          });
        },
        5,
      ),
    );

    // Get all features that were updated (both added/updated and removed)
    const allAffectedFeatures = [...requestedFeatures, ...featuresToRemove];

    // Only fetch feature keys, not the full documents with all refs
    const featuresUpdated = await getFeatureKeysForRepoBranch({
      repo,
      branch,
      features: allAffectedFeatures,
      organization: req.context.org,
    });

    return {
      featuresUpdated,
    };
  },
);
