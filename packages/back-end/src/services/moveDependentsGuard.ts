import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import {
  buildReverseDependencyIndex,
  getDependentFeatures,
  getTargetingProjectIds,
} from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import {
  getContextForAgendaJobByOrgObject,
  getEnvironments,
} from "back-end/src/services/organizations";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getAllExperimentsForStaleGraph } from "back-end/src/models/ExperimentModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { SoftWarningError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

// A soft (acknowledgeable) guard for moving a flag out of a project that still
// serves flags or experiments gating on it as a prerequisite. An SDK connection
// that serves a dependent but no longer the parent evaluates the parent as
// null, turning the dependent off. Connections that carry referenced
// prerequisites are unaffected, so only the others count.

type ScopeKey = "project" | "targetingProjects" | "targetingAllProjects";
export type DeliveryScope = Pick<FeatureInterface, ScopeKey>;

type ServedDependents = {
  features: Pick<FeatureInterface, "id" | ScopeKey>[];
  experiments: { id: string; project?: string }[];
};

type ConnectionScope = Pick<
  SDKConnectionInterface,
  "projects" | "includeReferencedPrerequisites" | "languages" | "sdkVersion"
>;

function servesProject(scope: DeliveryScope, project: string): boolean {
  const ids = getTargetingProjectIds(scope);
  return ids === null || ids.includes(project);
}

function withStaged(
  feature: DeliveryScope,
  staged: Partial<DeliveryScope>,
): DeliveryScope {
  return {
    project: staged.project ?? feature.project,
    targetingProjects: staged.targetingProjects ?? feature.targetingProjects,
    targetingAllProjects:
      staged.targetingAllProjects ?? feature.targetingAllProjects,
  };
}

// Whether `after` drops a project `before` served. Widening never strands.
export function deliveryScopeNarrowed(
  before: DeliveryScope,
  after: DeliveryScope,
): boolean {
  const beforeIds = getTargetingProjectIds(before);
  if (beforeIds === null) return getTargetingProjectIds(after) !== null;
  return beforeIds.some((p) => p && !servesProject(after, p));
}

export type StrandedDependents = {
  connections: number;
  features: number;
  experiments: number;
};

// Connections that would keep serving dependents without their parent: they
// served the parent before the move, do not after, and cannot carry it as a
// referenced prerequisite. Connections without a project filter serve every
// flag and are never affected.
export function getAffectedConnections<C extends ConnectionScope>(
  before: DeliveryScope,
  after: DeliveryScope,
  connections: C[],
): C[] {
  return connections.filter((conn) => {
    const projects = conn.projects ?? [];
    if (!projects.length) return false;
    if (!projects.some((p) => servesProject(before, p))) return false;
    if (projects.some((p) => servesProject(after, p))) return false;
    return !(
      conn.includeReferencedPrerequisites &&
      getConnectionSDKCapabilities(conn).includes("prerequisites")
    );
  });
}

export function getStrandedDependents(
  dependents: ServedDependents,
  affectedConnections: ConnectionScope[],
): StrandedDependents {
  const features = new Set<string>();
  const experiments = new Set<string>();
  let connections = 0;
  for (const conn of affectedConnections) {
    const projects = conn.projects ?? [];
    const served = {
      features: dependents.features.filter((f) =>
        projects.some((p) => servesProject(f, p)),
      ),
      experiments: dependents.experiments.filter((e) =>
        projects.includes(e.project ?? ""),
      ),
    };
    if (!served.features.length && !served.experiments.length) continue;
    connections++;
    served.features.forEach((f) => features.add(f.id));
    served.experiments.forEach((e) => experiments.add(e.id));
  }
  return {
    connections,
    features: features.size,
    experiments: experiments.size,
  };
}

async function collectDependents(
  scanContext: ReqContext | ApiReqContext,
  featureId: string,
): Promise<ServedDependents> {
  const [features, allExperiments] = await Promise.all([
    getAllFeaturesWithoutEditorFields(scanContext, {}),
    getAllExperimentsForStaleGraph(scanContext),
  ]);
  const featuresMap = new Map(features.map((f) => [f.id, f]));
  const dependentIds = getDependentFeatures(
    { id: featureId } as FeatureInterface,
    features,
    getEnvironments(scanContext.org).map((e) => e.id),
    buildReverseDependencyIndex(features),
    featuresMap,
  );
  return {
    features: dependentIds
      .filter((id) => id !== featureId)
      .map((id) => featuresMap.get(id))
      .filter((f): f is FeatureInterface => !!f),
    experiments: allExperiments.filter((e) =>
      e.phases.slice(-1)[0]?.prerequisites?.some((p) => p.id === featureId),
    ),
  };
}

// Runs where a project or targeting change LANDS (direct update, draft
// publish, revert). `staged` holds only the fields the change sets.
export async function assertFeatureMoveDependentsGuard(
  context: ReqContext | ApiReqContext,
  feature: Pick<FeatureInterface, "id" | ScopeKey>,
  staged: Partial<DeliveryScope> | undefined,
): Promise<void> {
  if (!staged) return;
  const after = withStaged(feature, staged);
  if (!deliveryScopeNarrowed(feature, after)) return;

  // Connections are few and decide whether the org-wide scan is needed at all.
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const affected = getAffectedConnections(
    feature,
    after,
    await findSDKConnectionsByOrganization(scanContext),
  );
  if (!affected.length) return;

  const stranded = getStrandedDependents(
    await collectDependents(scanContext, feature.id),
    affected,
  );
  if (!stranded.connections) return;

  const parts = [
    [stranded.features, "feature flag(s)"],
    [stranded.experiments, "experiment(s)"],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`);
  if (context.ignoreWarnings) {
    logger.info(
      { featureId: feature.id, userId: context.userId, stranded },
      "Move-dependents guard overridden",
    );
    return;
  }
  throw new SoftWarningError(
    `Moving this feature flag would leave ${parts.join(" and ")} without their prerequisite on ${stranded.connections} SDK Connection(s) that do not include referenced prerequisites. Re-submit with ignoreWarnings to move anyway.`,
    parts,
  );
}
