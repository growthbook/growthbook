import isEqual from "lodash/isEqual";
import { experimentHasLinkedChanges, validateFeatureValue } from "shared/util";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { AuditInterfaceInput } from "shared/types/audit";
import { EventUser } from "shared/types/events/event-types";
import { ExperimentChangesBody, ExperimentRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import {
  getExperimentById,
  setPendingFeatureUnlink,
} from "back-end/src/models/ExperimentModel";
import { getFeature, getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  deleteRevisionForFailedLanding,
  getRevision,
  getRevisionSnapshot,
  prevalidateRevisionUpdate,
  restoreRevisionSnapshot,
  RevisionSnapshot,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getDraftRevision,
  getLiveRevisionForFeature,
} from "back-end/src/services/features";
import {
  ExperimentFeatureUpdatePlan,
  ExperimentLinkedFeatureValueUpdate,
  planExperimentRuleEnvironments,
  updateExperimentRefVariations,
  validateExperimentFeatureUpdate,
  validateExperimentFeatureVariations,
  linkFeatureToExperiment,
  assertFlagKeepable,
  assertFlagRemovable,
  keepFlagInExperiment,
  removeFlagFromExperiment,
} from "back-end/src/services/experiment-feature";
import {
  assertScopedRules,
  assertValidRuleWrite,
  isDraftStatus,
  withStagedSchema,
} from "back-end/src/api/features/validations";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  ExperimentUpdatePlan,
  finishExperimentUpdate,
  planExperimentUpdate,
  writeExperimentUpdatePlan,
} from "./planExperimentUpdate";
import {
  LinkedChangesPlan,
  planLinkedChanges,
  writeLinkedChanges,
} from "./linkedChanges";
import { asJson, changedSinceLoaded, isoOrNull } from "./loadedBase";

// A dry run writes nothing: `experiment` is as loaded and `flags` is empty.
export type ExperimentChangesResult = {
  dryRun: boolean;
  experiment: ExperimentInterface;
  flags: { featureId: string; version: number }[];
};

type FlagValuesGroupPlan = Pick<
  ExperimentFeatureUpdatePlan,
  "matchingRules"
> & {
  update: ExperimentLinkedFeatureValueUpdate;
  scope: ReturnType<typeof planExperimentRuleEnvironments> | null;
};

// One flag's values, written into one draft: all of its experiment rules, or
// several groups of them when those rules disagree.
type FlagValuesPlan = Omit<ExperimentFeatureUpdatePlan, "matchingRules"> & {
  groups: FlagValuesGroupPlan[];
};

type FlagValuesEntry = NonNullable<ExperimentChangesBody["flagValues"]>[number];

function assertFlagValuesEntries(
  featureId: string,
  entries: FlagValuesEntry[],
) {
  if (entries.length === 1) {
    if (entries[0].ruleIds && entries[0].environments) {
      throw new BadRequestError(
        `Feature Flag ${featureId}: environments can only change for all of the experiment's rules at once.`,
      );
    }
    return;
  }
  const [{ revision }] = entries;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.ruleIds || entry.environments) {
      throw new BadRequestError(
        `Feature Flag ${featureId} can appear more than once only to set values for separate groups of its rules.`,
      );
    }
    if (
      entry.revision.version !== revision.version ||
      entry.revision.dateUpdated !== revision.dateUpdated
    ) {
      throw new BadRequestError(
        `Feature Flag ${featureId}: every group of rules must be loaded from the same revision.`,
      );
    }
    for (const id of entry.ruleIds) {
      if (seen.has(id)) {
        throw new BadRequestError(
          `Feature Flag ${featureId}: rule ${id} is in more than one group.`,
        );
      }
      seen.add(id);
    }
  }
}

type Compensation = {
  featureId: string;
  version: number;
  // Null when this save created the draft: undoing it deletes the draft.
  snapshot: RevisionSnapshot | null;
  writtenDateUpdated: Date | undefined;
};

// Read but not written by every plan, so a move underneath invalidates it.
const PLAN_INPUT_FIELDS: (keyof ExperimentInterface)[] = [
  "status",
  "type",
  "archived",
  "project",
  "datasource",
  "variations",
  "linkedFeatures",
  "nextScheduledStatusUpdate",
];

function assertExperimentBaseMatches(
  experiment: ExperimentInterface,
  { changes, base }: NonNullable<ExperimentChangesBody["experiment"]>,
) {
  for (const key of Object.keys(changes)) {
    if (!(key in base)) {
      throw new BadRequestError(`base is missing the loaded value of ${key}`);
    }
    const current =
      key === "variationWeights" || key === "coverage"
        ? experiment.phases[experiment.phases.length - 1]?.[key]
        : experiment[key as keyof ExperimentInterface];
    if (!isEqual(asJson(current), asJson(base[key]))) {
      throw changedSinceLoaded("The experiment");
    }
  }
}

async function planFlagValues(
  context: ReqContext,
  experiment: ExperimentInterface,
  experimentPlan: ExperimentUpdatePlan | null,
  flagValues: NonNullable<ExperimentChangesBody["flagValues"]>,
): Promise<FlagValuesPlan[]> {
  const entriesByFeature = new Map<string, FlagValuesEntry[]>();
  for (const entry of flagValues) {
    entriesByFeature.set(entry.featureId, [
      ...(entriesByFeature.get(entry.featureId) ?? []),
      entry,
    ]);
  }
  entriesByFeature.forEach((entries, featureId) =>
    assertFlagValuesEntries(featureId, entries),
  );
  const ids = [...entriesByFeature.keys()];
  const linked = experiment.linkedFeatures ?? [];
  const unlinked = ids.find((id) => !linked.includes(id));
  if (unlinked) {
    throw new BadRequestError(
      `Feature Flag ${unlinked} is not linked to the experiment`,
    );
  }
  const features = await getFeaturesByIds(context, ids);
  const byId = new Map(features.map((f) => [f.id, f]));

  const nextExperiment = { ...experiment, ...experimentPlan?.changes };
  const nextWeights =
    nextExperiment.phases[nextExperiment.phases.length - 1]?.variationWeights;
  if (!nextWeights) {
    throw new BadRequestError("Experiment must have at least one phase");
  }

  const result: FlagValuesPlan[] = [];
  for (const [featureId, entries] of entriesByFeature) {
    const feature = byId.get(featureId);
    if (!feature) throw new NotFoundError(`Feature Flag ${featureId}`);
    if (!context.permissions.canEditFeatureDrafts(feature)) {
      context.permissions.throwPermissionError();
    }

    const loadedFrom = entries[0].revision;
    const loaded = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: loadedFrom.version,
    });
    // A published revision never changes, so its version alone pins it.
    const startsDraft = loadedFrom.version === feature.version;
    if (
      !loaded ||
      (!startsDraft &&
        (isoOrNull(loaded.dateUpdated) !== loadedFrom.dateUpdated ||
          !isDraftStatus(loaded.status)))
    ) {
      throw changedSinceLoaded(`Feature Flag ${feature.id}`);
    }

    let existingRevision: FeatureRevisionInterface | undefined;
    let startingRevision: FeatureRevisionInterface | undefined;
    let projected: FeatureRevisionInterface | undefined;
    const groups: FlagValuesGroupPlan[] = [];
    for (const entry of entries) {
      const update: ExperimentLinkedFeatureValueUpdate = {
        variations: entry.variations,
        ...(entry.sparse !== undefined && { sparse: entry.sparse }),
        ...(entry.environments && { environments: entry.environments }),
        ...(entry.ruleIds && { ruleIds: entry.ruleIds }),
        targetVersion: startsDraft ? null : loaded.version,
      };
      // Against the variations this save leaves, which the plan already vetted.
      validateExperimentFeatureVariations({
        variations: nextExperiment.variations,
        variationWeights: nextWeights,
        experimentType: nextExperiment.type,
        featureId: feature.id,
        update,
      });
      const plan = await validateExperimentFeatureUpdate({
        experiment,
        feature,
        update,
        context,
      });
      if (!plan) continue;
      // Re-read inside validateExperimentFeatureUpdate; it must still be the one checked above.
      if (
        plan.existingRevision &&
        isoOrNull(plan.existingRevision.dateUpdated) !== loadedFrom.dateUpdated
      ) {
        throw changedSinceLoaded(`Feature Flag ${feature.id}`);
      }
      existingRevision = plan.existingRevision;
      startingRevision ??=
        existingRevision ?? (await getLiveRevisionForFeature(context, feature));
      const base = projected ?? startingRevision;

      const judgedFeature = withStagedSchema(feature, base);
      // Normalizes too: loose JSON is repaired rather than stored malformed.
      update.variations.forEach((v, i) => {
        v.value = validateFeatureValue(
          judgedFeature,
          v.value,
          `Variation ${i}`,
        );
      });

      // One rule can match in several environments.
      const rules = [
        ...new Map(
          plan.matchingRules.map(({ rule }) => [rule.id, rule]),
        ).values(),
      ];
      const scope = update.environments
        ? planExperimentRuleEnvironments({
            feature,
            revision: base,
            experimentId: experiment.id,
            orgEnvironments: context.environments,
            scope: update.environments,
          })
        : null;
      const ruleUpdate = {
        variations: update.variations,
        ...(update.sparse !== undefined && { sparse: update.sparse }),
        ...scope?.ruleUpdate,
      };
      projected = applyPartialFeatureRuleUpdatesToRevision(
        base,
        rules.map((r) => r.id),
        ruleUpdate,
      );
      for (const rule of rules) {
        await assertValidRuleWrite(
          context,
          judgedFeature,
          { ...rule, ...ruleUpdate } as ExperimentRefRule,
          rule,
          [nextExperiment],
        );
      }
      groups.push({ matchingRules: plan.matchingRules, update, scope });
    }
    if (!projected || !startingRevision) continue;

    const environmentsEnabled = groups.find((g) => g.scope?.environmentsEnabled)
      ?.scope?.environmentsEnabled;
    // Off live, the values land on a new draft cut from it.
    await prevalidateRevisionUpdate(
      context,
      feature,
      existingRevision ?? { ...startingRevision, status: "draft" },
      {
        rules: projected.rules ?? [],
        ...(environmentsEnabled && { environmentsEnabled }),
      },
    );

    result.push({ feature, existingRevision, groups });
  }
  return result;
}

async function writeFlagValues({
  context,
  plan,
  eventAudit,
  compensations,
}: {
  context: ReqContext;
  plan: FlagValuesPlan;
  eventAudit: EventUser;
  compensations: Compensation[];
}): Promise<{ featureId: string; version: number }> {
  const { feature, existingRevision, groups } = plan;

  let snapshot: RevisionSnapshot | null = null;
  if (existingRevision) {
    snapshot = await getRevisionSnapshot(
      feature.organization,
      feature.id,
      existingRevision.version,
    );
    if (!snapshot) throw changedSinceLoaded(`Feature Flag ${feature.id}`);
  }
  let revision: FeatureRevisionInterface =
    existingRevision ??
    (await getDraftRevision(context, feature, feature.version));
  const compensation: Compensation = {
    featureId: feature.id,
    version: revision.version,
    snapshot,
    writtenDateUpdated: revision.dateUpdated,
  };
  compensations.push(compensation);

  for (const { matchingRules, update, scope } of groups) {
    revision = await updateExperimentRefVariations({
      context,
      feature,
      revision,
      matchingRules,
      updatedVariationValues: update.variations,
      sparse: update.sparse,
      ruleUpdates: scope?.ruleUpdate,
      user: eventAudit,
    });
    compensation.writtenDateUpdated = revision.dateUpdated;

    // The rule's new footprint switches its environments on, one way.
    if (scope?.environmentsEnabled) {
      revision =
        (await updateRevision(
          context,
          feature,
          revision,
          { environmentsEnabled: scope.environmentsEnabled },
          {
            user: eventAudit,
            action: "update experiment environments",
            subject: `to ${scope.scopedEnvironments.join(", ") || "no environments"}`,
            value: JSON.stringify(update.environments),
          },
          { guardDateUpdated: true },
        )) ?? revision;
      compensation.writtenDateUpdated = revision.dateUpdated;
    }
  }

  return { featureId: feature.id, version: revision.version };
}

async function compensate(
  context: ReqContext,
  compensations: Compensation[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const c of [...compensations].reverse()) {
    try {
      if (c.snapshot) {
        const restored = await restoreRevisionSnapshot(
          c.snapshot,
          c.writtenDateUpdated,
        );
        if (!restored) failed.push(`${c.featureId} (draft v${c.version})`);
      } else {
        await deleteRevisionForFailedLanding(
          context,
          context.org.id,
          c.featureId,
          c.version,
        );
      }
    } catch (e) {
      logger.error(e, `Could not roll back ${c.featureId} v${c.version}`);
      failed.push(`${c.featureId} (draft v${c.version})`);
    }
  }
  return failed;
}

// Joining a holdout is refused on the same terms the planner refuses leaving one.
function assertHoldoutChangeAllowed(
  experiment: ExperimentInterface,
  holdoutId: string | undefined,
) {
  if (holdoutId === undefined) return;
  if ((holdoutId || "") === (experiment.holdoutId || "")) return;
  if (
    experiment.status === "draft" &&
    !experimentHasLinkedChanges(experiment)
  ) {
    return;
  }
  throw new BadRequestError(
    "A holdout can only change while the experiment is a draft with nothing linked. Discard the holdout change, or set the status back to Draft and remove its linked changes.",
  );
}

// Drafts land first and the experiment last; a failure anywhere before the
// experiment write undoes the drafts in reverse.
export async function applyExperimentChanges({
  context,
  experiment,
  body,
  audit,
  eventAudit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  body: ExperimentChangesBody;
  audit: (data: AuditInterfaceInput) => Promise<void>;
  eventAudit: EventUser;
}): Promise<ExperimentChangesResult> {
  // The page's edits are the experiment's, whatever each also asks of a flag.
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  let experimentPlan: ExperimentUpdatePlan | null = null;
  if (body.experiment) {
    assertExperimentBaseMatches(experiment, body.experiment);
    assertHoldoutChangeAllowed(experiment, body.experiment.changes.holdoutId);
    experimentPlan = await planExperimentUpdate(
      context,
      experiment,
      body.experiment.changes,
    );
  }
  const flagPlans = body.flagValues?.length
    ? await planFlagValues(context, experiment, experimentPlan, body.flagValues)
    : [];

  if (body.unlinkFeatures?.some((id) => body.keepFeatures?.includes(id))) {
    throw new BadRequestError(
      "Remove a Feature Flag or keep it, not both in one save.",
    );
  }
  // Refuses before anything is written; each one checks again as it goes.
  for (const featureId of body.unlinkFeatures ?? []) {
    const feature = await getFeature(context, featureId);
    if (feature) await assertFlagRemovable(context, experiment, feature);
  }
  for (const featureId of body.keepFeatures ?? []) {
    const feature = await getFeature(context, featureId);
    if (feature) await assertFlagKeepable(context, experiment, feature);
  }
  for (const link of body.linkFeatures ?? []) {
    assertScopedRules(context, [{ id: "", ...linkRuleScope(link) }], []);
  }
  const linkedPlan = await planLinkedChanges(
    context,
    experiment,
    experimentPlan,
    body,
  );
  if (body.dryRun) return { dryRun: true, experiment, flags: [] };

  const compensations: Compensation[] = [];
  const flags: ExperimentChangesResult["flags"] = [];
  let written: {
    experiment: ExperimentInterface;
    updated: ExperimentInterface;
  };
  try {
    for (const plan of flagPlans) {
      flags.push(
        await writeFlagValues({ context, plan, eventAudit, compensations }),
      );
    }

    if (!experimentPlan || !Object.keys(experimentPlan.changes).length) {
      return {
        dryRun: false,
        experiment: await finishFlags({
          context,
          experiment,
          body,
          linkedPlan,
          eventAudit,
          audit,
        }),
        flags,
      };
    }

    const fresh = await getExperimentById(context, experiment.id);
    const readSet = new Set([
      ...PLAN_INPUT_FIELDS,
      ...(Object.keys(experimentPlan.changes) as (keyof ExperimentInterface)[]),
    ]);
    if (
      !fresh ||
      [...readSet].some(
        (key) => !isEqual(asJson(fresh[key]), asJson(experiment[key])),
      )
    ) {
      throw changedSinceLoaded("The experiment");
    }
    // Pins the short window since the re-read; the field check above covers the rest.
    written = {
      experiment: fresh,
      updated: await writeExperimentUpdatePlan({
        context,
        experiment: fresh,
        plan: experimentPlan,
        guard: { dateUpdated: fresh.dateUpdated },
      }),
    };
  } catch (e) {
    const failed = await compensate(context, compensations);
    if (!failed.length) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new InternalServerError(
      `${message} These Feature Flag drafts could not be rolled back and still hold the new values: ${failed.join(", ")}.`,
    );
  }

  await finishExperimentUpdate({
    context,
    experiment: written.experiment,
    updated: written.updated,
    plan: experimentPlan,
    audit,
  });
  return {
    dryRun: false,
    experiment: await finishFlags({
      context,
      experiment: written.updated,
      body,
      linkedPlan,
      eventAudit,
      audit,
    }),
    flags,
  };
}

// Where a flag linked again runs: every environment unless the link names some.
function linkRuleScope(
  link: NonNullable<ExperimentChangesBody["linkFeatures"]>[number],
) {
  return link.environments && !link.environments.allEnvironments
    ? { allEnvironments: false, environments: link.environments.environments }
    : { allEnvironments: true };
}

// Once the values and experiment have landed: flags linked again or unlinked,
// then Visual Editor changes and URL Redirects.
async function finishFlags({
  context,
  experiment,
  body,
  linkedPlan,
  eventAudit,
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  body: ExperimentChangesBody;
  linkedPlan: LinkedChangesPlan | null;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<ExperimentInterface> {
  for (const link of body.linkFeatures ?? []) {
    const feature = await getFeature(context, link.featureId);
    if (!feature) throw new NotFoundError(`Feature Flag ${link.featureId}`);
    await linkFeatureToExperiment({
      context,
      experiment,
      feature,
      rule: {
        type: "experiment-ref",
        id: "",
        description: "",
        enabled: true,
        experimentId: experiment.id,
        variations: link.variations,
        ...(link.sparse && { sparse: true }),
        ...linkRuleScope(link),
      },
      eventAudit,
      audit,
      forceNewDraft: true,
    });
    // Linked again, so a removal it was waiting on no longer applies.
    await setPendingFeatureUnlink(
      context,
      experiment.id,
      link.featureId,
      false,
    );
  }
  for (const featureId of body.unlinkFeatures ?? []) {
    await removeFlagFromExperiment({
      context,
      experiment,
      featureId,
      eventAudit,
    });
  }
  for (const featureId of body.keepFeatures ?? []) {
    await keepFlagInExperiment({ context, experiment, featureId, eventAudit });
  }
  if (linkedPlan) {
    await writeLinkedChanges({
      context,
      experimentId: experiment.id,
      plan: linkedPlan,
      audit,
    });
  }
  return body.linkFeatures?.length ||
    body.unlinkFeatures?.length ||
    body.keepFeatures?.length ||
    linkedPlan
    ? ((await getExperimentById(context, experiment.id)) ?? experiment)
    : experiment;
}
