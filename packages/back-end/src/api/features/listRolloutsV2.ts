import { listRolloutsV2Validator } from "shared/validators";
import { getApplicableEnvIds } from "shared/util";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { loadRolloutLookups } from "back-end/src/services/rollouts";
import { BadRequestError } from "back-end/src/util/errors";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getActiveRollouts } from "back-end/src/util/rollouts";

export const listRolloutsV2 = createApiRequestHandler(listRolloutsV2Validator)(
  async (req) => {
    const { environment, featureId, projectId } = req.query;
    const { limit, offset } = validatePagination(req.query);
    const orgEnvs = getEnvironments(req.organization);
    if (
      environment &&
      !getEnvironmentIdsFromOrg(req.organization).includes(environment)
    ) {
      throw new BadRequestError(`Unknown environment: '${environment}'`);
    }

    // getAllFeatures already drops features the caller cannot read.
    const features = (
      await getAllFeatures(req.context, {
        projects: projectId ? [projectId] : undefined,
        ids: featureId ? [featureId] : undefined,
      })
    ).sort((a, b) => a.id.localeCompare(b.id));
    const lookups = await loadRolloutLookups(req.context, features);

    const rollouts = features.flatMap((feature) =>
      getApplicableEnvIds(orgEnvs, feature)
        .filter((env) => !environment || env === environment)
        .flatMap((env) => getActiveRollouts(feature, env, lookups)),
    );
    const page = rollouts.slice(offset, offset + limit);
    const hasMore = offset + limit < rollouts.length;
    return {
      rollouts: page,
      limit,
      offset,
      count: page.length,
      total: rollouts.length,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  },
);
