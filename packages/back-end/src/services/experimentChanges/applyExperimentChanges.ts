import isEqual from "lodash/isEqual";
import { isManagedByExperiment, validateFeatureValue } from "shared/util";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { AuditInterfaceInput } from "shared/types/audit";
import { EventUser } from "shared/types/events/event-types";
import {
  ACTIVE_DRAFT_STATUSES,
  ExperimentChangesBody,
  ExperimentRefRule,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  deleteRevisionForFailedLanding,
  getActiveDraft,
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
  validateExperimentFeatureUpdates,
  validateExperimentFeatureVariations,
} from "back-end/src/services/experiment-feature";
import {
  discardManagedDraftIfNoop,
  requestReviewForManagedDraft,
  stageManagedFeatureFields,
} from "back-end/src/services/managedFeatures";
import {
  assertValidRuleWrite,
  withStagedSchema,
} from "back-end/src/api/features/validations";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
import {
  BadRequestError,
  ConflictError,
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

export type ExperimentChangesResult = {
  experiment: ExperimentInterface;
  flags: { featureId: string; version: number }[];
};

type FlagValuesPlan = ExperimentFeatureUpdatePlan & {
  update: ExperimentLinkedFeatureValueUpdate;
  managed: boolean;
  // The rule's environment re-scope, when the save carries one.
  scope: ReturnType<typeof planExperimentRuleEnvironments> | null;
};

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
];

const changedSinceLoaded = (what: string) =>
  new ConflictError(
    `${what} changed since you loaded it. Reload to see the latest version, then make your changes again.`,
  );

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

const isoOrNull = (date: Date | undefined | null) =>
  date ? new Date(date).toISOString() : null;

function latestWeights(experiment: Pick<ExperimentInterface, "phases">) {
  return experiment.phases[experiment.phases.length - 1]?.variationWeights;
}

function assertExperimentBaseMatches(
  experiment: ExperimentInterface,
  { changes, base }: NonNullable<ExperimentChangesBody["experiment"]>,
) {
  for (const key of Object.keys(changes)) {
    if (!(key in base)) {
      throw new BadRequestError(`base is missing the loaded value of ${key}`);
    }
    const current =
      key === "variationWeights"
        ? latestWeights(experiment)
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
  const ids = flagValues.map((f) => f.featureId);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestError("Each Feature Flag can appear only once.");
  }
  const linked = experiment.linkedFeatures ?? [];
  const unlinked = ids.find((id) => !linked.includes(id));
  if (unlinked) {
    throw new BadRequestError(
      `Feature Flag ${unlinked} is not linked to the experiment`,
    );
  }
  const features = await getFeaturesByIds(context, ids);
  const byId = new Map(features.map((f) => [f.id, f]));

  const updates: Record<string, ExperimentLinkedFeatureValueUpdate> = {};
  const checked = new Map<
    string,
    { entry: (typeof flagValues)[number]; managed: boolean }
  >();
  for (const entry of flagValues) {
    const feature = byId.get(entry.featureId);
    if (!feature) throw new NotFoundError(`Feature Flag ${entry.featureId}`);
    if (!context.permissions.canEditFeatureDrafts(feature)) {
      context.permissions.throwPermissionError();
    }

    const managed = isManagedByExperiment(feature, experiment.id);
    if (entry.valueType && entry.valueType !== feature.valueType && !managed) {
      throw new BadRequestError(
        `Feature ${feature.id}: only a Feature Flag managed by this experiment can change its value type here.`,
      );
    }

    const loaded = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: entry.revision.version,
    });
    // A published revision never changes, so its version alone pins it.
    const startsDraft = entry.revision.version === feature.version;
    if (
      !loaded ||
      (!startsDraft &&
        (isoOrNull(loaded.dateUpdated) !== entry.revision.dateUpdated ||
          !isEditableDraft(loaded)))
    ) {
      throw changedSinceLoaded(`Feature Flag ${feature.id}`);
    }
    // A managed flag has one draft; writing beside it would fork its review.
    if (managed) {
      const activeDraft = await getActiveDraft(context, feature);
      if ((activeDraft?.version ?? feature.version) !== loaded.version) {
        throw changedSinceLoaded(`Feature Flag ${feature.id}`);
      }
    }

    checked.set(feature.id, { entry, managed });
    updates[feature.id] = {
      variations: entry.variations,
      ...(entry.valueType && { valueType: entry.valueType }),
      ...(entry.sparse !== undefined && { sparse: entry.sparse }),
      ...(entry.environments && { environments: entry.environments }),
      revisionOptions: startsDraft
        ? { forceNewDraft: true }
        : { targetVersion: loaded.version },
    };
  }

  const nextExperiment = { ...experiment, ...experimentPlan?.changes };
  const nextWeights = latestWeights(nextExperiment);
  if (!nextWeights) {
    throw new BadRequestError("Experiment must have at least one phase");
  }
  validateExperimentFeatureVariations({
    variations: nextExperiment.variations,
    variationWeights: nextWeights,
    experiment,
    features: updates,
  });

  const plans = await validateExperimentFeatureUpdates({
    experiment,
    features: updates,
    linkedFeatures: features,
    context,
  });

  const result: FlagValuesPlan[] = [];
  for (const plan of plans) {
    const { feature, existingRevision, matchingRules } = plan;
    const update = updates[feature.id];
    const { entry, managed } = checked.get(feature.id)!;
    // Re-read inside validateExperimentFeatureUpdates; it must still be the one checked above.
    if (
      existingRevision &&
      isoOrNull(existingRevision.dateUpdated) !== entry.revision.dateUpdated
    ) {
      throw changedSinceLoaded(`Feature Flag ${feature.id}`);
    }
    const base =
      existingRevision ?? (await getLiveRevisionForFeature(context, feature));

    const landingType =
      update.valueType ?? base.metadata?.valueType ?? feature.valueType;
    const judgedFeature = {
      ...withStagedSchema(feature, base),
      valueType: landingType,
    };
    // Normalizes too: loose JSON is repaired rather than stored malformed.
    update.variations.forEach((v, i) => {
      v.value = validateFeatureValue(judgedFeature, v.value, `Variation ${i}`);
    });

    // One rule can match in several environments.
    const rules = [
      ...new Map(matchingRules.map(({ rule }) => [rule.id, rule])).values(),
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
    const projected = applyPartialFeatureRuleUpdatesToRevision(
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
      );
    }
    // Off live, the values land on a new draft cut from it.
    await prevalidateRevisionUpdate(
      context,
      feature,
      existingRevision ?? { ...base, status: "draft" },
      {
        rules: projected.rules ?? [],
        ...(scope?.environmentsEnabled && {
          environmentsEnabled: scope.environmentsEnabled,
        }),
      },
    );

    result.push({ ...plan, update, managed, scope });
  }
  return result;
}

function isEditableDraft(revision: FeatureRevisionInterface) {
  return (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status);
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
  const { feature, existingRevision, matchingRules, update, managed, scope } =
    plan;

  let revision: FeatureRevisionInterface;
  let compensation: Compensation;
  if (existingRevision) {
    const snapshot = await getRevisionSnapshot(
      feature.organization,
      feature.id,
      existingRevision.version,
    );
    if (!snapshot) throw changedSinceLoaded(`Feature Flag ${feature.id}`);
    revision = existingRevision;
    compensation = {
      featureId: feature.id,
      version: revision.version,
      snapshot,
      writtenDateUpdated: revision.dateUpdated,
    };
  } else {
    revision = await getDraftRevision(context, feature, feature.version);
    compensation = {
      featureId: feature.id,
      version: revision.version,
      snapshot: null,
      writtenDateUpdated: revision.dateUpdated,
    };
  }
  compensations.push(compensation);

  if (managed) {
    // Control drives a managed flag's default.
    revision = await stageManagedFeatureFields({
      context,
      feature,
      revision,
      ...(update.valueType && { valueType: update.valueType }),
      defaultValue: update.variations[0].value,
      eventAudit,
      guardDateUpdated: true,
    });
    compensation.writtenDateUpdated = revision.dateUpdated;
  }

  revision = await updateExperimentRefVariations({
    context,
    feature,
    revision,
    matchingRules,
    updatedVariationValues: update.variations,
    sparse: update.sparse,
    ruleUpdates: scope?.ruleUpdate,
    user: eventAudit,
    guardDateUpdated: true,
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

  let version = revision.version;
  if (managed) {
    if (
      await discardManagedDraftIfNoop({
        context,
        feature,
        revision,
        eventAudit,
      })
    ) {
      version = feature.version;
    } else {
      await requestReviewForManagedDraft({
        context,
        feature,
        version: revision.version,
        eventAudit,
      });
    }
    // Both write the draft without handing it back.
    compensation.writtenDateUpdated = (
      await getRevisionSnapshot(
        feature.organization,
        feature.id,
        revision.version,
      )
    )?.dateUpdated;
  }
  return { featureId: feature.id, version };
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
  let experimentPlan: ExperimentUpdatePlan | null = null;
  if (body.experiment) {
    assertExperimentBaseMatches(experiment, body.experiment);
    experimentPlan = await planExperimentUpdate(
      context,
      experiment,
      body.experiment.changes,
    );
  }
  const flagPlans = body.flagValues?.length
    ? await planFlagValues(context, experiment, experimentPlan, body.flagValues)
    : [];

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
      return { experiment, flags };
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
    written = await writeExperimentUpdatePlan({
      context,
      experiment: fresh,
      plan: experimentPlan,
      audit,
      guard: { dateUpdated: fresh.dateUpdated },
    });
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
  return { experiment: written.updated, flags };
}
