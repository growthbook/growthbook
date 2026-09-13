import { isFeatureCyclic } from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { FeaturePrerequisite } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

// A prerequisite may point only at an existing, unarchived boolean flag — the
// constraints the dashboard's prerequisite picker applies — and, for features,
// at one that does not itself depend on the feature being written. Only
// parents a write introduces are checked, so anything already pointing at a
// since-archived parent still posts back unchanged.

type Context = ReqContext | ApiReqContext;

function prerequisiteIdsOf(
  feature: Pick<FeatureInterface, "prerequisites" | "rules">,
): Set<string> {
  const ids = new Set<string>();
  (feature.prerequisites ?? []).forEach((p) => ids.add(p.id));
  (feature.rules ?? []).forEach((rule) =>
    (rule.prerequisites ?? []).forEach((p) => ids.add(p.id)),
  );
  return ids;
}

// One query per hop; a real prerequisite chain is a handful deep, so a walk
// still open after this many hops is refused rather than left unchecked.
const MAX_PREREQUISITE_DEPTH = 50;

// Every ancestor of `seeds`. Loaded through the org-wide scan context (as the
// delete guard does) so an ancestor in a project the caller cannot read still
// contributes its edges; the caller never sees these documents. Follows
// disabled rules too, matching isFeatureCyclic.
async function loadPrerequisiteAncestors(
  context: Context,
  seeds: FeatureInterface[],
): Promise<Map<string, FeatureInterface>> {
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const loaded = new Map(seeds.map((f) => [f.id, f]));
  let frontier = seeds;
  for (let depth = 0; ; depth++) {
    const wanted = [
      ...new Set(frontier.flatMap((f) => [...prerequisiteIdsOf(f)])),
    ].filter((id) => !loaded.has(id));
    if (!wanted.length) return loaded;
    if (depth >= MAX_PREREQUISITE_DEPTH) {
      throw new BadRequestError("Prerequisite chain is too deep to validate");
    }
    frontier = await getAllFeaturesWithoutEditorFields(scanContext, {
      ids: wanted,
      includeArchived: true,
    });
    frontier.forEach((f) => loaded.set(f.id, f));
  }
}

// The parents themselves: readable, present, unarchived, boolean.
async function loadValidParents(
  context: Context,
  ids: string[],
): Promise<FeatureInterface[]> {
  const parents = await getAllFeaturesWithoutEditorFields(context, {
    ids,
    includeArchived: true,
  });
  const byId = new Map(parents.map((f) => [f.id, f]));
  for (const id of ids) {
    const parent = byId.get(id);
    if (!parent) {
      throw new NotFoundError(`Prerequisite feature "${id}" not found`);
    }
    if (parent.archived) {
      throw new BadRequestError(`Prerequisite feature "${id}" is archived`);
    }
    if (parent.valueType !== "boolean") {
      throw new BadRequestError(
        `Prerequisite feature "${id}" must be a boolean feature, not ${parent.valueType}`,
      );
    }
  }
  return parents;
}

// Feature writes: `candidate` is the feature as it will be stored, `stored`
// as it is stored now. Rule-level and feature-level prerequisites both count,
// and the new parents' ancestor chains are walked for a cycle.
export async function assertValidPrerequisiteParents(
  context: Context,
  candidate: FeatureInterface,
  stored?: Pick<FeatureInterface, "prerequisites" | "rules">,
): Promise<void> {
  const prior = stored ? prerequisiteIdsOf(stored) : new Set<string>();
  const added = [...prerequisiteIdsOf(candidate)].filter(
    (id) => !prior.has(id),
  );
  if (!added.length) return;
  if (added.includes(candidate.id)) {
    throw new BadRequestError(
      `Feature "${candidate.id}" cannot be its own prerequisite`,
    );
  }

  const parents = await loadValidParents(context, added);
  const graph = await loadPrerequisiteAncestors(context, parents);
  graph.set(candidate.id, candidate);
  if (isFeatureCyclic(candidate, graph)[0]) {
    const names = added.map((id) => `"${id}"`).join(", ");
    throw new BadRequestError(
      `Prerequisite ${names} would create a circular dependency`,
    );
  }
}

// Experiment writes: the prerequisites as they will be stored versus as they
// are stored now — a single phase's, or every phase's when the whole array is
// replaced. Experiments are leaves of the prerequisite graph, so there is no
// cycle to walk.
export async function assertValidExperimentPrerequisites(
  context: Context,
  inbound: FeaturePrerequisite[] | undefined,
  stored: FeaturePrerequisite[] | undefined = [],
): Promise<void> {
  const prior = new Set(stored.map((p) => p.id));
  const added = [...new Set((inbound ?? []).map((p) => p.id))].filter(
    (id) => !prior.has(id),
  );
  if (added.length) await loadValidParents(context, added);
}

export function phasePrerequisites(
  phases: { prerequisites?: FeaturePrerequisite[] }[] | undefined,
): FeaturePrerequisite[] {
  return (phases ?? []).flatMap((p) => p.prerequisites ?? []);
}
