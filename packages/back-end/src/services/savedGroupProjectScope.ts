import { isEqual } from "lodash";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  assertSavedGroupReferencesInScope,
  featureForSavedGroupValidation,
  savedGroupIdsInTargeting,
  savedGroupScopeChangeBreaksTargeting,
  savedGroupScopeRuleCounterparts,
  scopedRules,
  Feature,
  Group,
  ProjectScope,
  ScopedRule,
} from "back-end/src/util/savedGroupProjectScope.util";
import { BadRequestError } from "back-end/src/util/errors";
import {
  gateOr5xx,
  makeBlockingGate,
  PublishGate,
} from "back-end/src/revisions/publishGates";

export async function assertFeatureSavedGroupScope(
  context: Context,
  feature: Feature,
  previous?: Feature | Feature[],
): Promise<void> {
  if (context.org.settings?.enforceSavedGroupProjectScope !== true) return;
  const current = scopedRules(feature);
  const baselines = (
    Array.isArray(previous) ? previous : previous ? [previous] : []
  ).map((state) => ({
    rules: scopedRules(state),
    counterparts: savedGroupScopeRuleCounterparts(
      state.rules ?? [],
      feature.rules ?? [],
    ),
  }));
  if (baselines.some((baseline) => isEqual(current, baseline.rules))) return;

  const toValidate: [{ savedGroups: { ids: string[] }[] }, ProjectScope][] = [];
  for (const { rule, projects: delivery } of current) {
    // No stored counterpart means no exemption from the validation below.
    const prior = baselines.flatMap(({ counterparts, rules }) => {
      const counterpart = counterparts.get(rule);
      return rules.filter((r) => r.rule === counterpart);
    });
    for (const id of savedGroupIdsInTargeting(rule)) {
      let projects = delivery;
      // Grandfather the same reference where it was already stored. New rule
      // references and additional delivery Projects still require full DAG validation.
      for (const existing of prior) {
        if (!savedGroupIdsInTargeting(existing.rule).has(id)) continue;
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
  const scan =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const groups = new Map(
    (await scan.models.savedGroups.getAllWithoutValues()).map((g) => [g.id, g]),
  );
  for (const [t, projects] of toValidate) {
    assertSavedGroupReferencesInScope(t, projects, groups);
  }
}

export async function assertSavedGroupProjectScope(
  context: Context,
  proposed: Group,
  previous?: Group,
): Promise<void> {
  if (context.org.settings?.enforceSavedGroupProjectScope !== true) return;
  // A newly allocated group ID cannot have existing consumers. Its nested
  // graph is checked when a Feature Flag first references it.
  if (!previous) return;
  const narrowsScope =
    !!proposed.projects?.length &&
    (!previous.projects?.length ||
      previous.projects.some((p) => !proposed.projects!.includes(p)));
  const changesReferences =
    proposed.type === "condition" &&
    proposed.condition !== previous.condition &&
    savedGroupIdsInTargeting(proposed).size > 0;
  // Unused groups may cross their own Project boundaries. Only a change that
  // can invalidate a consumer needs an org-wide scan.
  if (!narrowsScope && !changesReferences) return;

  // See consumers the caller cannot read. Bulk publish's overlay supplies the
  // whole proposed release, instead of intermediate state.
  const scan =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const groups = new Map<string, Group>(
    (await scan.models.savedGroups.getAllWithoutValues()).map((g) => [g.id, g]),
  );
  const breaks = ({ rule, projects }: ScopedRule) =>
    savedGroupScopeChangeBreaksTargeting(
      rule,
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

  const features = await getAllFeaturesWithoutEditorFields(scan, {
    includeArchived: true,
  });
  const byId = Object.fromEntries(features.map((f) => [f.id, f]));
  const drafts = await getRevisionsByStatus(scan, [...ACTIVE_DRAFT_STATUSES], {
    featuresByFeatureId: byId,
  });
  for (const feature of features) {
    if (scopedRules(feature).some(breaks)) refuse();
  }
  for (const draft of drafts) {
    const feature = byId[draft.featureId];
    // A bulk overlay already contains this draft's proposed published state.
    if (feature?.version === draft.version) continue;
    if (
      feature &&
      scopedRules(featureForSavedGroupValidation(feature, draft)).some(breaks)
    )
      refuse();
  }
  // Saved Group drafts have no evaluation scope of their own. Their proposed
  // graphs are checked at publication, against the then-current consumers.
}

// Strict scope is an org policy, so no per-publication override can clear it.
// Only application rejections become gates; infrastructure failures stay 5xx.
export async function collectSavedGroupScopeGate(
  validate: () => Promise<void>,
): Promise<PublishGate[]> {
  try {
    await validate();
    return [];
  } catch (error) {
    return [
      gateOr5xx(error, (message) =>
        makeBlockingGate({
          type: "saved-group-project-scope",
          messages: [message],
        }),
      ),
    ];
  }
}
