import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import {
  buildReverseDependencyIndex,
  entityTargetsProject,
  filterProjectsByEnvironmentWithNull,
  getDependentFeatures,
  getTargetingProjectIds,
} from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { Environment } from "shared/types/organization";
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
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { SoftWarningError } from "back-end/src/util/errors";

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
  | "projects"
  | "environment"
  | "includeReferencedPrerequisites"
  | "languages"
  | "sdkVersion"
>;

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
  return beforeIds.some((p) => p && !entityTargetsProject(after, p));
}

// The project lists of connections that would keep serving dependents without
// their parent: they served the parent before the move, do not after, and
// cannot carry it as a referenced prerequisite. A connection's projects are
// read the way the payload reads them, narrowed by its environment; one that
// serves every project always has the parent and is never affected.
export function getAffectedConnectionProjects(
  before: DeliveryScope,
  after: DeliveryScope,
  connections: ConnectionScope[],
  environments: Environment[],
): string[][] {
  const affected: string[][] = [];
  for (const conn of connections) {
    const projects = filterProjectsByEnvironmentWithNull(
      conn.projects ?? [],
      environments.find((e) => e.id === conn.environment),
      true,
    );
    if (!projects?.length) continue;
    if (!projects.some((p) => entityTargetsProject(before, p))) continue;
    if (projects.some((p) => entityTargetsProject(after, p))) continue;
    if (
      conn.includeReferencedPrerequisites &&
      getConnectionSDKCapabilities(conn).includes("prerequisites")
    ) {
      continue;
    }
    affected.push(projects);
  }
  return affected;
}

export type StrandedDependents = {
  connections: number;
  features: number;
  experiments: number;
};

export function getStrandedDependents(
  dependents: ServedDependents,
  affectedConnectionProjects: string[][],
): StrandedDependents {
  const features = new Set<string>();
  const experiments = new Set<string>();
  let connections = 0;
  for (const projects of affectedConnectionProjects) {
    const served = {
      features: dependents.features.filter((f) =>
        projects.some((p) => entityTargetsProject(f, p)),
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

// The warning a landing change would raise, or null. `staged` holds only the
// fields the change sets. Connections are few and decide whether the org-wide
// scan is needed at all.
async function collectMoveWarning(
  context: ReqContext | ApiReqContext,
  feature: Pick<FeatureInterface, "id" | ScopeKey>,
  staged: Partial<DeliveryScope> | undefined,
): Promise<{ message: string; parts: string[] } | null> {
  if (!staged) return null;
  const after = withStaged(feature, staged);
  if (!deliveryScopeNarrowed(feature, after)) return null;

  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const affected = getAffectedConnectionProjects(
    feature,
    after,
    await findSDKConnectionsByOrganization(scanContext),
    getEnvironments(scanContext.org),
  );
  if (!affected.length) return null;

  const stranded = getStrandedDependents(
    await collectDependents(scanContext, feature.id),
    affected,
  );
  if (!stranded.connections) return null;

  const parts = [
    [stranded.features, "feature flag(s)"],
    [stranded.experiments, "experiment(s)"],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`);
  return {
    parts,
    message: `Moving this feature flag would leave ${parts.join(" and ")} without their prerequisite on ${stranded.connections} SDK Connection(s) that do not include referenced prerequisites.`,
  };
}

// Gate form for the aggregated publish surfaces (interactive REST publish and
// bulk publish), which report every warning in one 422.
export async function collectFeatureMoveDependentsGate(
  context: ReqContext | ApiReqContext,
  feature: Pick<FeatureInterface, "id" | ScopeKey>,
  staged: Partial<DeliveryScope> | undefined,
): Promise<PublishGate | null> {
  const warning = await collectMoveWarning(context, feature, staged);
  if (!warning) return null;
  return {
    type: "move-dependents",
    severity: "warning",
    messages: [warning.message],
    override: "ignoreWarnings",
    requiresPermission: null,
    resolution: null,
  };
}

// Throwing form for the surfaces that land a change directly (dashboard update
// and reverts, REST update and reverts, armed publishes). Runs before any
// draft is inserted, so a warning leaves nothing behind.
export async function assertFeatureMoveDependentsGuard(
  context: ReqContext | ApiReqContext,
  feature: Pick<FeatureInterface, "id" | ScopeKey>,
  staged: Partial<DeliveryScope> | undefined,
): Promise<void> {
  if (context.ignoreWarnings) return;
  const warning = await collectMoveWarning(context, feature, staged);
  if (!warning) return;
  throw new SoftWarningError(
    `${warning.message} Re-submit with ignoreWarnings to move anyway.`,
    warning.parts,
  );
}
