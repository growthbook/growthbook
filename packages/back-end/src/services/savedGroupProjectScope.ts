import { isEqual } from "lodash";
import {
  findStoredRuleCounterpart,
  getTargetingProjectIds,
  isSavedGroupAvailableForProjects,
  ruleProjectScope,
} from "shared/util";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { SavedGroupInterface } from "shared/types/saved-group";
import type { Context } from "back-end/src/models/BaseModel";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

type Group = Pick<
  SavedGroupInterface,
  "id" | "type" | "condition" | "projects"
>;
type Targeting = {
  condition?: string;
  savedGroups?: { ids: string[] }[];
  prerequisites?: { condition?: string }[];
};
type Feature = Pick<
  FeatureInterface,
  | "project"
  | "targetingProjects"
  | "targetingAllProjects"
  | "rules"
  | "prerequisites"
  | "environmentSettings"
>;
type ProjectScope = string[] | null;
type ScopedTargeting = {
  key: string;
  targeting: Targeting;
  projects: ProjectScope;
  rule?: Feature["rules"][number];
};

// Parse operators, not substrings: IDs may also appear as ordinary targeting
// values. Covers nested logical operators and both positive/negative membership.
export function savedGroupIdsInTargeting(targeting: Targeting): Set<string> {
  const ids = new Set(targeting.savedGroups?.flatMap((s) => s.ids));
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$savedGroups") {
        for (const id of Array.isArray(child) ? child : [child]) {
          if (typeof id === "string") ids.add(id);
        }
      } else if (key === "$inGroup" || key === "$notInGroup") {
        if (typeof child === "string") ids.add(child);
      } else {
        visit(child);
      }
    }
  };
  for (const condition of [
    targeting.condition,
    ...(targeting.prerequisites ?? []).map((p) => p.condition),
  ]) {
    if (!condition) continue;
    try {
      visit(JSON.parse(condition));
    } catch {
      throw new BadRequestError("Invalid targeting condition JSON");
    }
  }
  return ids;
}

export function assertSavedGroupReferencesInScope(
  targeting: Targeting,
  projects: ProjectScope,
  groups: Map<string, Group>,
): void {
  if (projects?.length === 0) return;
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const group = groups.get(id);
    if (!group)
      throw new NotFoundError("A referenced Saved Group was not found.");
    if (!isSavedGroupAvailableForProjects(group, projects)) {
      throw new BadRequestError(
        "A referenced Saved Group is not available in every Project targeted by this Feature Flag. Share the Saved Group with those Projects or remove the reference.",
      );
    }
    if (group.type === "condition") {
      for (const nested of savedGroupIdsInTargeting(group)) visit(nested);
    }
  };
  for (const id of savedGroupIdsInTargeting(targeting)) visit(id);
}

function featureTargeting(feature: Feature): ScopedTargeting[] {
  const projects = getTargetingProjectIds(feature);
  return [
    {
      key: "feature",
      targeting: { prerequisites: feature.prerequisites },
      projects,
    },
    ...Object.entries(feature.environmentSettings ?? {})
      .filter(([, env]) => env.enabled)
      .map(([id, env]) => ({
        key: `environment:${id}`,
        targeting: env,
        projects,
      })),
    ...(feature.rules ?? []).map((rule): ScopedTargeting => {
      const ruleProjects = ruleProjectScope(rule);
      // Match SDK delivery: intersect the rule's scope with the Feature Flag's
      // primary/targeting Projects. Group-to-group scopes do not constrain it.
      const delivery =
        ruleProjects === null
          ? projects
          : projects === null
            ? ruleProjects
            : ruleProjects.filter((p) => projects.includes(p));
      return {
        key: `rule:${rule.id}`,
        targeting: rule,
        projects: delivery,
        rule,
      };
    }),
  ];
}

export async function assertFeatureSavedGroupScope(
  context: Context,
  feature: Feature,
  previous?: Feature | Feature[],
): Promise<void> {
  if (context.org.settings?.enforceSavedGroupProjectScope !== true) return;
  const targeting = featureTargeting(feature);
  const baselines = (
    Array.isArray(previous) ? previous : previous ? [previous] : []
  ).map((state) => ({ state, targeting: featureTargeting(state) }));
  if (baselines.some((baseline) => isEqual(targeting, baseline.targeting)))
    return;

  const toValidate: [Targeting, ProjectScope][] = [];
  for (const current of targeting) {
    const prior = baselines.flatMap((baseline) => {
      const counterpart = current.rule
        ? findStoredRuleCounterpart(baseline.state.rules ?? [], current.rule)
        : undefined;
      // No stored counterpart means no exemption from the validation below.
      if (current.rule && !counterpart) return [];
      const key = current.rule ? `rule:${counterpart?.id}` : current.key;
      return baseline.targeting.filter((t) => t.key === key);
    });
    for (const id of savedGroupIdsInTargeting(current.targeting)) {
      let projects = current.projects;
      // Grandfather the same reference where it was already stored. New rule
      // references and additional delivery Projects still require full DAG validation.
      for (const existing of prior) {
        if (!savedGroupIdsInTargeting(existing.targeting).has(id)) continue;
        if (existing.projects === null) {
          projects = [];
          break;
        }
        const existingProjects = existing.projects;
        if (projects !== null) {
          projects = projects.filter((p) => !existingProjects.includes(p));
        }
      }
      if (projects?.length === 0) continue;
      toValidate.push([{ savedGroups: [{ ids: [id] }] }, projects]);
    }
  }
  if (!toValidate.length) return;

  // Scope is independent of the editor's read access: descendants can cross
  // Project boundaries. Existing route validators still enforce direct reads.
  // Errors deliberately do not reveal IDs from the org-wide graph.
  const { getContextForAgendaJobByOrgObject } = await import("./organizations");
  const scan =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const groups = new Map(
    (await scan.models.savedGroups.getAll()).map((g) => [g.id, g]),
  );
  for (const [t, projects] of toValidate) {
    assertSavedGroupReferencesInScope(t, projects, groups);
  }
}

export function featureForSavedGroupValidation(
  feature: Feature,
  revision: Pick<
    FeatureRevisionInterface,
    "metadata" | "rules" | "prerequisites" | "environmentsEnabled"
  >,
): Feature {
  return {
    ...feature,
    ...revision.metadata,
    rules: revision.rules,
    prerequisites: revision.prerequisites,
    environmentSettings: Object.fromEntries(
      Object.entries(feature.environmentSettings ?? {}).map(([id, env]) => [
        id,
        { ...env, enabled: revision.environmentsEnabled?.[id] ?? env.enabled },
      ]),
    ),
  };
}

// Compare the full consumer DAG before and after a group change. Track each
// denied Project separately so an existing violation in one Project cannot
// hide a new violation in another. Unrelated legacy violations allow repair.
export function savedGroupScopeChangeBreaksTargeting(
  targeting: Targeting,
  projects: ProjectScope,
  proposed: Group,
  groups: Map<string, Group>,
  previous?: Group,
): boolean {
  const violations = (replacement?: Group): Set<string> => {
    const denied = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const group = id === proposed.id ? replacement : groups.get(id);
      if (!group) return; // Existence is validated by the targeting validators.
      if (group.projects?.length) {
        for (const project of projects ?? [null]) {
          if (project === null || !group.projects.includes(project)) {
            denied.add(JSON.stringify([id, project]));
          }
        }
      }
      if (group.type === "condition") {
        for (const nested of savedGroupIdsInTargeting(group)) visit(nested);
      }
    };
    for (const id of savedGroupIdsInTargeting(targeting)) visit(id);
    return denied;
  };
  const before = violations(previous);
  return [...violations(proposed)].some((key) => !before.has(key));
}

export async function assertSavedGroupProjectScope(
  context: Context,
  proposed: Group,
  previous?: Group,
): Promise<void> {
  if (context.org.settings?.enforceSavedGroupProjectScope !== true) return;
  const narrowsScope =
    !!previous &&
    !!proposed.projects?.length &&
    (!previous.projects?.length ||
      previous.projects.some((p) => !proposed.projects!.includes(p)));
  const changesReferences =
    proposed.type === "condition" &&
    proposed.condition !== previous?.condition &&
    savedGroupIdsInTargeting(proposed).size > 0;
  // Unused groups may cross their own Project boundaries. Only a change that
  // can invalidate a consumer needs an org-wide scan.
  if (!narrowsScope && !changesReferences) return;

  // See consumers the caller cannot read. Bulk publish's overlay supplies the
  // whole proposed release, instead of intermediate state.
  const { getContextForAgendaJobByOrgObject } = await import("./organizations");
  const scan =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const groups = new Map<string, Group>(
    (await scan.models.savedGroups.getAll()).map((g) => [g.id, g]),
  );
  const breaks = (targeting: Targeting, projects: ProjectScope) =>
    savedGroupScopeChangeBreaksTargeting(
      targeting,
      projects,
      proposed,
      groups,
      previous,
    );
  const refuse = () => {
    // Never disclose IDs or names from unreadable Projects.
    throw new BadRequestError(
      "Cannot change this Saved Group: existing Feature Flag references would be outside the Saved Groups' Project scope. Remove or update those references (including active Feature Flag drafts) first.",
    );
  };

  const { getAllFeaturesWithoutEditorFields } = await import(
    "back-end/src/models/FeatureModel"
  );
  const { getRevisionsByStatus } = await import(
    "back-end/src/models/FeatureRevisionModel"
  );
  const features = await getAllFeaturesWithoutEditorFields(scan, {
    includeArchived: true,
  });
  const byId = Object.fromEntries(features.map((f) => [f.id, f]));
  const drafts = await getRevisionsByStatus(scan, [...ACTIVE_DRAFT_STATUSES], {
    featuresByFeatureId: byId,
  });
  for (const feature of features) {
    if (
      featureTargeting(feature).some(({ targeting, projects }) =>
        breaks(targeting, projects),
      )
    )
      refuse();
  }
  for (const draft of drafts) {
    const feature = byId[draft.featureId];
    // A bulk overlay already contains this draft's proposed published state.
    if (feature?.version === draft.version) continue;
    if (
      feature &&
      featureTargeting(featureForSavedGroupValidation(feature, draft)).some(
        ({ targeting, projects }) => breaks(targeting, projects),
      )
    )
      refuse();
  }
  // Saved Group drafts have no evaluation scope of their own. Their proposed
  // graphs are checked at publication, against the then-current consumers.
}
