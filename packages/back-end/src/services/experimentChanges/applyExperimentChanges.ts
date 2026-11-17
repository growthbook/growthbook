import isEqual from "lodash/isEqual";
import { validateFeatureValue } from "shared/util";
import { conflictingFields } from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { AuditInterfaceInput } from "shared/types/audit";
import { EventUser } from "shared/types/events/event-types";
import { ExperimentChangesBody, ExperimentRefRule } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import {
  getExperimentById,
  setPendingFeatureUnlink,
} from "back-end/src/models/ExperimentModel";
import { getFeature, getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  deleteRevisionForFailedLanding,
  getLinkageSyncRevisionSummaries,
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
import { syncFeatureExperimentLinkages } from "back-end/src/util/featureExperimentSync";
import {
  ExperimentFeatureUpdatePlan,
  ExperimentLinkedFeatureValueUpdate,
  planExperimentRuleEnvironments,
  updateExperimentRefVariations,
  validateExperimentFeatureUpdate,
  validateExperimentFeatureVariations,
  linkFeatureToExperiment,
  assertFlagLinkable,
  prevalidateFlagLink,
  flagHoldsExperimentRule,
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
  ChangesConflictError,
  ConflictError,
  InternalServerError,
  NotFoundError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { runValidateFeatureHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  insertNewFeature,
  prepareNewFeature,
} from "back-end/src/services/featureCreate";
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
import {
  asJson,
  assertBaseCoversChanges,
  changedSinceLoaded,
  isoOrNull,
} from "./loadedBase";

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
type LinkFeatureEntry = NonNullable<
  ExperimentChangesBody["linkFeatures"]
>[number];
type CreateFeatureEntry = NonNullable<
  ExperimentChangesBody["createFeatures"]
>[number];
type PlannedCreate = { feature: FeatureInterface; entry: CreateFeatureEntry };

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
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.ruleIds || entry.environments) {
      throw new BadRequestError(
        `Feature Flag ${featureId} can appear more than once only to set values for separate groups of its rules.`,
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

// Someone else changed it since it was loaded, to something this save doesn't set.
function experimentFieldConflicts(
  experiment: ExperimentInterface,
  body: NonNullable<ExperimentChangesBody["experiment"]>,
): string[] {
  assertBaseCoversChanges(body.changes, body.base);
  return conflictingFields(experiment, body);
}

async function planFlagValues(
  context: ReqContext,
  experiment: ExperimentInterface,
  experimentPlan: ExperimentUpdatePlan | null,
  flagValues: NonNullable<ExperimentChangesBody["flagValues"]>,
): Promise<{ plans: FlagValuesPlan[]; conflicts: string[] }> {
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
  const conflicts: string[] = [];
  features: for (const [featureId, entries] of entriesByFeature) {
    const feature = byId.get(featureId);
    if (!feature)
      throw new NotFoundError(`Feature Flag ${featureId} not found`);
    if (!context.permissions.canEditFeatureDrafts(feature)) {
      context.permissions.throwPermissionError();
    }

    const loadedFrom = entries[0].revision;
    // Groups staged on either side of someone else's save disagree.
    const loadedApart = entries.some(
      ({ revision }) =>
        revision.version !== loadedFrom.version ||
        revision.dateUpdated !== loadedFrom.dateUpdated,
    );
    const loaded = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: loadedFrom.version,
    });
    // Loaded from live, which never changes, so its version alone pins it. A
    // draft loaded and published since is no longer a draft, so it conflicts.
    const startsDraft =
      loadedFrom.dateUpdated === null && loadedFrom.version === feature.version;
    if (
      loadedApart ||
      !loaded ||
      (!startsDraft &&
        (isoOrNull(loaded.dateUpdated) !== loadedFrom.dateUpdated ||
          !isDraftStatus(loaded.status)))
    ) {
      conflicts.push(feature.id);
      continue;
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
        conflicts.push(feature.id);
        continue features;
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
  return { plans: result, conflicts };
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
    // Moved since it was planned: nothing is written, so there's nothing to undo.
    if (
      !snapshot ||
      isoOrNull(snapshot.dateUpdated) !==
        isoOrNull(existingRevision.dateUpdated)
    ) {
      throw changedSinceLoaded(`Feature Flag ${feature.id}`);
    }
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
  // A draft this save created goes if anything fails; an existing one only
  // needs restoring once this save has written to it.
  if (!snapshot) compensations.push(compensation);

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
    if (!compensations.includes(compensation)) compensations.push(compensation);
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
            subject: `to ${scope.scopedEnvironments.join(", ")}`,
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
      const undone = c.snapshot
        ? await restoreRevisionSnapshot(c.snapshot, c.writtenDateUpdated)
        : await deleteRevisionForFailedLanding(
            context,
            context.org.id,
            c.featureId,
            c.version,
            c.writtenDateUpdated,
          );
      if (!undone) failed.push(`${c.featureId} (draft v${c.version})`);
    } catch (e) {
      logger.error(e, `Could not roll back ${c.featureId} v${c.version}`);
      failed.push(`${c.featureId} (draft v${c.version})`);
    }
  }
  // A restored or deleted draft changes what each experiment queues to
  // publish; rebuilt before the failure returns, so a start right after sees it.
  await Promise.all(
    [...new Set(compensations.map((c) => c.featureId))].map(
      async (featureId) => {
        try {
          const { openDrafts, liveRevision } =
            await getLinkageSyncRevisionSummaries(context.org.id, featureId);
          await syncFeatureExperimentLinkages(
            context,
            featureId,
            openDrafts,
            liveRevision,
          );
        } catch (e) {
          logger.error(e, `Could not resync ${featureId} after rolling back`);
        }
      },
    ),
  );
  return failed;
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
  const fieldConflicts = body.experiment
    ? experimentFieldConflicts(experiment, body.experiment)
    : [];
  if (body.experiment || body.release) {
    experimentPlan = await planExperimentUpdate(
      context,
      experiment,
      body.experiment?.changes ?? {},
      { release: body.release },
    );
  }
  const { plans: flagPlans, conflicts: flagConflicts } = body.flagValues?.length
    ? await planFlagValues(context, experiment, experimentPlan, body.flagValues)
    : { plans: [], conflicts: [] };
  if (fieldConflicts.length || flagConflicts.length) {
    throw new ChangesConflictError({
      fields: fieldConflicts,
      featureIds: flagConflicts,
      urlRedirectIds: [],
      visualChangesetIds: [],
    });
  }

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
  // Past a draft, a new rule would change who sees what mid-run.
  if (
    experiment.status !== "draft" &&
    (body.linkFeatures?.length || body.createFeatures?.length)
  ) {
    throw new BadRequestError(
      "Set the experiment's status back to draft to link a Feature Flag.",
    );
  }
  // Each link's own checks, against the experiment this save leaves, with the
  // other flags it links too.
  const plannedExperiment: ExperimentInterface = {
    ...experiment,
    ...experimentPlan?.changes,
    linkedFeatures: [
      ...new Set([
        ...(experiment.linkedFeatures ?? []),
        ...(body.linkFeatures ?? []).map((link) => link.featureId),
        ...(body.createFeatures ?? []).map((c) => c.feature.id),
      ]),
    ],
  };
  await assertNewVariationsCovered(
    context,
    experiment,
    plannedExperiment,
    body,
  );
  for (const link of body.linkFeatures ?? []) {
    assertScopedRules(context, [{ id: "", ...linkRuleScope(link) }], []);
    const feature = await getFeature(context, link.featureId);
    if (!feature)
      throw new NotFoundError(`Feature Flag ${link.featureId} not found`);
    // Linked again only once its rule is gone, or leaving: a second rule would
    // serve the experiment twice.
    if (
      !experiment.pendingFeatureUnlinks?.includes(link.featureId) &&
      (await flagHoldsExperimentRule(context, feature, experiment.id))
    ) {
      throw new BadRequestError(
        `${link.featureId} is already linked to this experiment.`,
      );
    }
    await prevalidateFlagLink(
      linkCheck(context, plannedExperiment, feature, link),
    );
  }
  const creates = await planCreates(context, plannedExperiment, body, {
    runHooks: true,
  });
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

    // Every save, linked changes alone too, lands only on the experiment it
    // was planned against: started or scheduled since, it stops here.
    const fresh = await getExperimentById(context, experiment.id);
    const readSet = new Set([
      ...PLAN_INPUT_FIELDS,
      ...(Object.keys(
        experimentPlan?.changes ?? {},
      ) as (keyof ExperimentInterface)[]),
    ]);
    if (
      !fresh ||
      [...readSet].some(
        (key) => !isEqual(asJson(fresh[key]), asJson(experiment[key])),
      )
    ) {
      throw changedSinceLoaded("The experiment");
    }

    if (!experimentPlan || !Object.keys(experimentPlan.changes).length) {
      return {
        dryRun: false,
        experiment: await finishFlags({
          context,
          experiment,
          body,
          linkedPlan,
          creates,
          eventAudit,
          audit,
        }),
        flags,
      };
    }
    // Nothing rolls back once the experiment lands, so the linked changes'
    // bases and the new flags are checked again first.
    if (linkedPlan) {
      await planLinkedChanges(context, experiment, experimentPlan, body);
    }
    await planCreates(context, plannedExperiment, body, { runHooks: false });
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
  try {
    return {
      dryRun: false,
      experiment: await finishFlags({
        context,
        experiment: written.updated,
        body,
        linkedPlan,
        creates,
        eventAudit,
        audit,
      }),
      flags,
    };
  } catch (e) {
    const message = `The experiment's changes saved, but not all of its linked changes did: ${
      e instanceof Error ? e.message : String(e)
    }`;
    throw e instanceof ConflictError
      ? new ConflictError(message)
      : new InternalServerError(message);
  }
}

// Every flag serving the experiment needs a value for a variation this save
// adds, or serves it null; a kept flag's restored rule predates the new ones.
async function assertNewVariationsCovered(
  context: ReqContext,
  experiment: ExperimentInterface,
  planned: ExperimentInterface,
  body: ExperimentChangesBody,
) {
  const before = new Set(experiment.variations.map((v) => v.id));
  if (planned.variations.every((v) => before.has(v.id))) return;
  if (body.keepFeatures?.length) {
    throw new BadRequestError(
      "Keep a Feature Flag in a save of its own, before adding variations.",
    );
  }
  const covered = new Set([
    ...(body.flagValues ?? []).map((f) => f.featureId),
    ...(body.linkFeatures ?? []).map((f) => f.featureId),
    ...(body.unlinkFeatures ?? []),
  ]);
  const missing: string[] = [];
  for (const id of experiment.linkedFeatures ?? []) {
    if (covered.has(id)) continue;
    const feature = await getFeature(context, id);
    if (
      feature &&
      (await flagHoldsExperimentRule(context, feature, experiment.id))
    ) {
      missing.push(id);
    }
  }
  if (missing.length) {
    throw new BadRequestError(
      `Give each linked Feature Flag a value for the new variations: ${missing.join(", ")}.`,
    );
  }
}

// Each new flag checked as POST /feature checks one, with its values checked
// against the experiment this save leaves. Writes nothing.
async function planCreates(
  context: ReqContext,
  planned: ExperimentInterface,
  body: ExperimentChangesBody,
  { runHooks }: { runHooks: boolean },
): Promise<PlannedCreate[]> {
  const entries = body.createFeatures ?? [];
  const ids = entries.map((entry) => entry.feature.id);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestError("Each new Feature Flag needs its own key.");
  }
  const creates: PlannedCreate[] = [];
  for (const entry of entries) {
    assertScopedRules(context, [{ id: "", ...linkRuleScope(entry) }], []);
    const feature = await prepareNewFeature(context, entry.feature);
    const check = linkCheck(context, planned, feature, entry);
    if (runHooks) {
      await runValidateFeatureHooks({ context, feature, original: null });
      await prevalidateFlagLink(check, { unsaved: true });
    } else {
      await assertFlagLinkable(check);
    }
    creates.push({ feature, entry });
  }
  return creates;
}

// Where a flag linked again runs: every environment unless the link names some.
function linkRuleScope(link: LinkFeatureEntry | CreateFeatureEntry) {
  return link.environments && !link.environments.allEnvironments
    ? { allEnvironments: false, environments: link.environments.environments }
    : { allEnvironments: true };
}

function linkRule(
  experimentId: string,
  link: LinkFeatureEntry | CreateFeatureEntry,
): ExperimentRefRule {
  return {
    type: "experiment-ref",
    id: "",
    description: "",
    enabled: true,
    experimentId,
    variations: link.variations,
    ...(link.sparse && { sparse: true }),
    ...linkRuleScope(link),
  };
}

// A flag's link always lands on a new draft.
function linkCheck(
  context: ReqContext,
  experiment: ExperimentInterface,
  feature: FeatureInterface,
  link: LinkFeatureEntry | CreateFeatureEntry,
) {
  return {
    context,
    experiment,
    feature,
    rule: linkRule(experiment.id, link),
    forceNewDraft: true,
  };
}

// Once the values and experiment have landed: flags created, linked again,
// unlinked or kept, then Visual Editor changes and URL Redirects.
async function finishFlags({
  context,
  experiment,
  body,
  linkedPlan,
  creates,
  eventAudit,
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  body: ExperimentChangesBody;
  linkedPlan: LinkedChangesPlan | null;
  creates: PlannedCreate[];
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<ExperimentInterface> {
  for (const { feature, entry } of creates) {
    await insertNewFeature(context, feature, audit);
    await linkFeatureToExperiment({
      ...linkCheck(context, experiment, feature, entry),
      eventAudit,
      audit,
    });
  }
  for (const link of body.linkFeatures ?? []) {
    const feature = await getFeature(context, link.featureId);
    if (!feature)
      throw new NotFoundError(`Feature Flag ${link.featureId} not found`);
    await linkFeatureToExperiment({
      ...linkCheck(context, experiment, feature, link),
      eventAudit,
      audit,
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
  return creates.length ||
    body.linkFeatures?.length ||
    body.unlinkFeatures?.length ||
    body.keepFeatures?.length ||
    linkedPlan
    ? ((await getExperimentById(context, experiment.id)) ?? experiment)
    : experiment;
}
