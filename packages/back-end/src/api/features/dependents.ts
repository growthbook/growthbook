import { getDependentExperiments, getDependentFeatures } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { ApiFeatureDependents, ApiWarning } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { buildFeatureLookups } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";

/**
 * Features and experiments that directly list the given feature as a
 * prerequisite (1-hop). Same lookup the internal `/features/dependents`
 * endpoint uses — requires loading the org's full feature + experiment set,
 * so it's only wired into single-feature API endpoints.
 */
export async function computeFeatureDependents(
  context: ApiReqContext,
  feature: FeatureInterface,
): Promise<ApiFeatureDependents> {
  const [allFeatures, allExperiments] = await Promise.all([
    getAllFeatures(context, { includeArchived: true }),
    getAllExperiments(context, { includeArchived: true }),
  ]);

  const { featuresMap, reverseDependencyIndex, experiments } =
    buildFeatureLookups(allFeatures, allExperiments);

  return {
    features: getDependentFeatures(
      feature,
      allFeatures,
      getEnvironmentIdsFromOrg(context.org),
      reverseDependencyIndex,
      featuresMap,
    ),
    experiments: getDependentExperiments(feature, experiments).map((e) => ({
      id: e.id,
      name: e.name,
    })),
  };
}

export function hasDependents(dependents: ApiFeatureDependents): boolean {
  return dependents.features.length > 0 || dependents.experiments.length > 0;
}

function describeDependentCounts(dependents: ApiFeatureDependents): string {
  const parts: string[] = [];
  if (dependents.features.length > 0) {
    parts.push(
      `${dependents.features.length} feature${
        dependents.features.length === 1 ? "" : "s"
      }`,
    );
  }
  if (dependents.experiments.length > 0) {
    parts.push(
      `${dependents.experiments.length} experiment${
        dependents.experiments.length === 1 ? "" : "s"
      }`,
    );
  }
  return parts.join(" and ");
}

export function buildDependentsWarning(
  dependents: ApiFeatureDependents,
): ApiWarning {
  return {
    type: "prerequisiteDependents",
    message: `This feature is a prerequisite for ${describeDependentCounts(
      dependents,
    )}. Your change may affect them.`,
  };
}

export function buildDependentsError(
  action: "delete" | "archive",
  dependents: ApiFeatureDependents,
): Error {
  const refs: string[] = [];
  if (dependents.features.length > 0) {
    refs.push(`feature(s) ${dependents.features.join(", ")}`);
  }
  if (dependents.experiments.length > 0) {
    refs.push(
      `experiment(s) ${dependents.experiments.map((e) => e.id).join(", ")}`,
    );
  }
  return new Error(
    `Cannot ${action} feature: it is a prerequisite for ${refs.join(
      " and ",
    )}. Remove these prerequisite references first.`,
  );
}
