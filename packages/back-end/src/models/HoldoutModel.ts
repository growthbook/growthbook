import { z } from "zod";
import {
  coverageToHoldoutSize,
  getAllowedHoldoutStageSources,
  getHoldoutStage,
  HoldoutStage,
  isHoldoutStageTransitionAllowed,
  stringToBoolean,
} from "shared/util";
import {
  ApiHoldoutInterface,
  apiCreateHoldoutBody,
  apiHoldoutActionReturn,
  apiHoldoutActionValidator,
  apiUpdateHoldoutBody,
  HOLDOUT_API_TARGETING_UPDATE_FIELDS,
  HoldoutInterface,
  holdoutValidator,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { ExperimentInterface } from "shared/types/experiment";
import { getCollection } from "back-end/src/util/mongo.util";
import {
  BadRequestError,
  InvalidStatusError,
  NotFoundError,
} from "back-end/src/util/errors";
import {
  holdoutApiSpec,
  holdoutStartAnalysisEndpoint,
  holdoutStartEndpoint,
  holdoutStopEndpoint,
} from "back-end/src/api/specs/holdout.spec";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import { ApiRequest } from "back-end/src/util/handler";
import {
  createHoldoutWithExperiment,
  normalizeHoldoutScheduleUpdates,
  setHoldoutStage,
  updateHoldoutWithExperiment,
} from "back-end/src/services/holdouts";
import {
  resolveOwnerEmail,
  resolveOwnerEmails,
  resolveOwnerForCreate,
} from "back-end/src/services/owner";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { MakeModelClass } from "./BaseModel";
import { getExperimentById, getExperimentsByIds } from "./ExperimentModel";

const COLLECTION_NAME = "holdouts";

type HoldoutActionRequest = ApiRequest<
  z.infer<typeof apiHoldoutActionReturn>,
  typeof apiHoldoutActionValidator.paramsSchema,
  typeof apiHoldoutActionValidator.bodySchema,
  typeof apiHoldoutActionValidator.querySchema
>;

async function handleHoldoutStageTransition(
  req: HoldoutActionRequest,
  {
    targetStage,
    invalidStatusMessage,
  }: {
    targetStage: HoldoutStage;
    invalidStatusMessage: string;
  },
): Promise<z.infer<typeof apiHoldoutActionReturn>> {
  const holdout = await req.context.models.holdout.getById(req.params.id);
  if (!holdout) {
    return req.context.throwNotFoundError();
  }
  const experiment = await getExperimentById(req.context, holdout.experimentId);
  if (!experiment) {
    return req.context.throwNotFoundError("Holdout experiment not found");
  }

  const envs = getEnvironmentIdsFromOrg(req.context.org);
  if (!req.context.permissions.canRunHoldout(holdout, envs)) {
    req.context.permissions.throwPermissionError();
  }

  const currentStage = getHoldoutStage(holdout, experiment);
  if (!isHoldoutStageTransitionAllowed(currentStage, targetStage)) {
    throw new InvalidStatusError(
      invalidStatusMessage,
      currentStage,
      getAllowedHoldoutStageSources(targetStage),
    );
  }

  await setHoldoutStage(req.context, {
    holdout,
    experiment,
    stage: targetStage,
  });

  const [updatedHoldout, updatedExperiment] = await Promise.all([
    req.context.models.holdout.getById(holdout.id),
    getExperimentById(req.context, holdout.experimentId),
  ]);
  if (!updatedHoldout || !updatedExperiment) {
    return req.context.throwNotFoundError();
  }

  return {
    holdout: await resolveOwnerEmail(
      toApiHoldout(updatedHoldout, updatedExperiment),
      req.context,
    ),
  };
}

const BaseClass = MakeModelClass({
  schema: holdoutValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "hld_",
  auditLog: {
    entity: "holdout",
    createEvent: "holdout.create",
    updateEvent: "holdout.update",
    deleteEvent: "holdout.delete",
  },
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    skipAsDefaultHoldout: false,
  } as Partial<HoldoutInterface>,
  additionalIndexes: [
    {
      fields: { "nextScheduledStatusUpdate.date": 1 },
    },
  ],
  apiConfig: {
    modelKey: "holdout",
    openApiSpec: holdoutApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...holdoutStartEndpoint,
        reqHandler: (req) =>
          handleHoldoutStageTransition(req, {
            targetStage: "running",
            invalidStatusMessage:
              "Holdout must be in the draft stage before it can start.",
          }),
      }),
      defineCustomApiHandler({
        ...holdoutStartAnalysisEndpoint,
        reqHandler: (req) =>
          handleHoldoutStageTransition(req, {
            targetStage: "analysis-period",
            invalidStatusMessage:
              "Holdout must be running before its analysis period can start.",
          }),
      }),
      defineCustomApiHandler({
        ...holdoutStopEndpoint,
        reqHandler: (req) =>
          handleHoldoutStageTransition(req, {
            targetStage: "stopped",
            invalidStatusMessage:
              "Holdout must be running or in its analysis period before it can stop.",
          }),
      }),
    ],
  },
});

// Guarded on BOTH maps by every linkage write, even one that touches only one of
// them: they are updated together often enough (link a feature with its
// experiments, compensate a publish) that guarding half would let the other half
// be clobbered by a writer this one never saw.
const LINKAGE_FIELDS = ["linkedFeatures", "linkedExperiments"] as const;

/**
 * Merges a holdout and its companion experiment into the public API shape.
 *
 * A holdout is invalid without its companion experiment, so callers must resolve
 * it before serializing.
 */
export function toApiHoldout(
  holdout: HoldoutInterface,
  experiment: ExperimentInterface,
): ApiHoldoutInterface {
  const phase = experiment.phases[experiment.phases.length - 1];
  const firstPhase = experiment.phases[0];

  return {
    id: holdout.id,
    dateCreated: holdout.dateCreated.toISOString(),
    dateUpdated: holdout.dateUpdated.toISOString(),
    name: holdout.name,
    description: experiment.description ?? "",
    projects: holdout.projects,
    owner: experiment.owner,
    tags: experiment.tags,
    archived: experiment.archived,
    stage: getHoldoutStage(holdout, experiment),
    experimentId: holdout.experimentId,
    trackingKey: experiment.trackingKey,
    skipAsDefaultHoldout: holdout.skipAsDefaultHoldout ?? false,

    holdoutSize: coverageToHoldoutSize(phase?.coverage ?? 0),
    hashAttribute: experiment.hashAttribute,
    targetingCondition: phase?.condition ?? "",
    savedGroupTargeting: phase?.savedGroups,

    datasourceId: experiment.datasource,
    assignmentQueryId: experiment.exposureQueryId,
    goalMetrics: experiment.goalMetrics,
    secondaryMetrics: experiment.secondaryMetrics,
    variations: experiment.variations.map((v) => ({
      variationId: v.id,
      key: v.key,
      name: v.name,
      description: v.description,
    })),

    environments: Object.fromEntries(
      Object.entries(holdout.environmentSettings).map(([id, settings]) => [
        id,
        { enabled: settings.enabled },
      ]),
    ),

    linkedFeatures: Object.values(holdout.linkedFeatures).map((f) => ({
      id: f.id,
      dateAdded: f.dateAdded.toISOString(),
    })),
    linkedExperiments: Object.values(holdout.linkedExperiments).map((e) => ({
      id: e.id,
      dateAdded: e.dateAdded.toISOString(),
    })),

    dateStarted: firstPhase?.dateStarted?.toISOString(),
    analysisStartDate: holdout.analysisStartDate?.toISOString(),
    dateStopped:
      experiment.status === "stopped"
        ? phase?.dateEnded?.toISOString()
        : undefined,

    statusUpdateSchedule: holdout.statusUpdateSchedule
      ? {
          startAt: holdout.statusUpdateSchedule.startAt?.toISOString(),
          startAnalysisPeriodAt:
            holdout.statusUpdateSchedule.startAnalysisPeriodAt?.toISOString(),
          stopAt: holdout.statusUpdateSchedule.stopAt?.toISOString(),
        }
      : holdout.statusUpdateSchedule,
    nextScheduledStatusUpdate: holdout.nextScheduledStatusUpdate
      ? {
          type: holdout.nextScheduledStatusUpdate.type,
          date: holdout.nextScheduledStatusUpdate.date.toISOString(),
        }
      : holdout.nextScheduledStatusUpdate,
  };
}

export class HoldoutModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: HoldoutInterface): boolean {
    return this.context.permissions.canCreateHoldout(doc);
  }
  protected canRead(doc: HoldoutInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canUpdate(
    existing: HoldoutInterface,
    _updates: UpdateProps<HoldoutInterface>,
    newDoc: HoldoutInterface,
  ): boolean {
    return this.context.permissions.canUpdateHoldout(existing, newDoc);
  }
  protected canDelete(doc: HoldoutInterface): boolean {
    return this.context.permissions.canDeleteHoldout(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("holdouts");
  }

  /***************
   * REST API handlers
   *
   * All four are overridden because the default implementations assume a single
   * document: `toApiInterface` is synchronous and per-doc, so it cannot fetch
   * the companion experiment that supplies most of the API shape.
   ***************/

  protected toApiInterface(): ApiHoldoutInterface {
    // A holdout needs its companion experiment to serialize, and fetching it is
    // async. Every handler below resolves the experiment and calls `toApiHoldout`
    // directly, so this default is never the right path.
    throw new Error(
      "Use handleApi* handlers to serialize a Holdout; toApiInterface cannot resolve its experiment.",
    );
  }

  private async getExperimentOrThrow(
    holdout: HoldoutInterface,
  ): Promise<ExperimentInterface> {
    const experiment = await getExperimentById(
      this.context,
      holdout.experimentId,
    );
    if (!experiment) {
      // A 404 rather than a 500: the Holdout exists but is missing its other half.
      this.context.throwNotFoundError("Holdout experiment not found");
    }
    return experiment;
  }

  public override async handleApiGet(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiGet"]>[0],
  ): Promise<ApiHoldoutInterface> {
    const holdout = await this.getById(req.params.id);
    if (!holdout) req.context.throwNotFoundError();
    const experiment = await this.getExperimentOrThrow(holdout);
    return resolveOwnerEmail(toApiHoldout(holdout, experiment), this.context);
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiHoldoutInterface[]> {
    const { projectId, datasourceId, stage, archived } = req.query;

    const holdouts = await this.getAll();
    const filteredByProject = projectId
      ? holdouts.filter((h) => h.projects.includes(projectId))
      : holdouts;

    // Batch the experiment lookup rather than one query per holdout.
    const experiments = await getExperimentsByIds(
      this.context,
      filteredByProject.map((h) => h.experimentId),
    );
    const experimentsById = new Map(experiments.map((e) => [e.id, e]));

    const wantArchived =
      archived === undefined ? undefined : stringToBoolean(archived.toString());

    const results: ApiHoldoutInterface[] = [];
    for (const holdout of filteredByProject) {
      const experiment = experimentsById.get(holdout.experimentId);
      // A holdout without its companion experiment is invalid, so drop it.
      if (!experiment) continue;
      if (datasourceId && experiment.datasource !== datasourceId) continue;
      if (stage && getHoldoutStage(holdout, experiment) !== stage) continue;
      if (
        wantArchived !== undefined &&
        !!experiment.archived !== wantArchived
      ) {
        continue;
      }
      results.push(toApiHoldout(holdout, experiment));
    }

    return resolveOwnerEmails(results, this.context);
  }

  public override async handleApiCreate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiCreate"]>[0],
  ): Promise<ApiHoldoutInterface> {
    const body = apiCreateHoldoutBody.parse(req.body);

    const owner = await resolveOwnerForCreate(body.owner, this.context);

    const { holdout, experiment } = await createHoldoutWithExperiment(
      this.context,
      {
        name: body.name,
        description: body.description,
        projects: body.projects,
        owner,
        tags: body.tags,
        skipAsDefaultHoldout: body.skipAsDefaultHoldout,
        datasourceId: body.datasourceId,
        assignmentQueryId: body.assignmentQueryId,
        hashAttribute: body.hashAttribute || "id",
        holdoutSize: body.holdoutSize,
        targetingCondition: body.targetingCondition,
        savedGroups: body.savedGroupTargeting,
        goalMetrics: body.goalMetrics,
        secondaryMetrics: body.secondaryMetrics,
        statsEngine: body.statsEngine,
        environmentSettings: body.environments
          ? Object.fromEntries(
              Object.entries(body.environments).map(([id, settings]) => [
                id,
                { enabled: settings.enabled },
              ]),
            )
          : undefined,
      },
    );

    // Applied after creation so it is validated against the real stored stage.
    if (body.statusUpdateSchedule) {
      const withSchedule = await this.update(
        holdout,
        normalizeHoldoutScheduleUpdates({
          holdout,
          experiment,
          scheduleInput: body.statusUpdateSchedule,
        }),
      );
      return resolveOwnerEmail(
        toApiHoldout(withSchedule, experiment),
        this.context,
      );
    }

    return resolveOwnerEmail(toApiHoldout(holdout, experiment), this.context);
  }

  public override async handleApiUpdate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiUpdate"]>[0],
  ): Promise<ApiHoldoutInterface> {
    const body = apiUpdateHoldoutBody.parse(req.body);

    const holdout = await this.getById(req.params.id);
    if (!holdout) req.context.throwNotFoundError();
    const experiment = await this.getExperimentOrThrow(holdout);

    // Gate every path explicitly. Writes to the companion experiment go through
    // `updateExperiment`, which does no permission checking of its own, and a
    // body touching only experiment-side fields never reaches `this.update`.
    if (
      !this.context.permissions.canUpdateHoldout(holdout, {
        projects: body.projects ?? holdout.projects,
      })
    ) {
      this.context.permissions.throwPermissionError();
    }

    // Targeting and sizing changes reach live SDK payloads, so they additionally
    // require run permission on the Holdout's environments — the same bar the
    // internal targeting endpoint applies.
    const isTargetingChange = HOLDOUT_API_TARGETING_UPDATE_FIELDS.some(
      (field) => body[field] !== undefined,
    );
    if (isTargetingChange) {
      const envs = Object.keys(holdout.environmentSettings).filter(
        (env) => holdout.environmentSettings[env]?.enabled,
      );
      if (
        envs.length > 0 &&
        !this.context.permissions.canRunHoldout(holdout, envs)
      ) {
        this.context.permissions.throwPermissionError();
      }
    }

    const { holdout: updated, experiment: updatedExperiment } =
      await updateHoldoutWithExperiment(this.context, {
        holdout,
        experiment,
        body,
      });

    return resolveOwnerEmail(
      toApiHoldout(updated, updatedExperiment),
      this.context,
    );
  }

  protected async beforeUpdate(
    existing: HoldoutInterface,
    updates: Partial<HoldoutInterface>,
  ) {
    // Every check below validates schedule dates. Returning early keeps a
    // linkage-only write from having to resolve the holdout's experiment, which
    // `getExperimentById` hides from anyone without `readData` on its project —
    // the holdout experiment carries `project: ""`, so that is the caller's
    // global role, and a project-scoped flag publisher would fail mid-publish.
    if ((updates.statusUpdateSchedule ?? null) === null) return;

    const holdoutExperiment = await getExperimentById(
      this.context,
      existing.experimentId,
    );
    if (!holdoutExperiment) {
      throw new NotFoundError("Holdout experiment not found");
    }

    const { startAt, startAnalysisPeriodAt, stopAt } =
      updates.statusUpdateSchedule ?? {};

    const now = new Date();
    const currentStage = getHoldoutStage(existing, holdoutExperiment);

    // Check if one of the scheduled dates is in the past
    if (startAt && currentStage === "draft" && new Date(startAt) < now) {
      throw new BadRequestError("Scheduled start date cannot be in the past");
    }
    if (
      startAnalysisPeriodAt &&
      currentStage === "running" &&
      new Date(startAnalysisPeriodAt) < now
    ) {
      throw new BadRequestError(
        "Scheduled analysis start date cannot be in the past",
      );
    }
    if (stopAt && currentStage !== "stopped" && new Date(stopAt) < now) {
      throw new BadRequestError("Scheduled stop date cannot be in the past");
    }

    // Check date dependencies
    if (
      currentStage === "draft" &&
      stopAt &&
      (!startAt || !startAnalysisPeriodAt)
    ) {
      throw new BadRequestError(
        "To set a stop date, you must also set a start date and an analysis start date",
      );
    }
    if (currentStage === "draft" && startAnalysisPeriodAt && !startAt) {
      throw new BadRequestError(
        "To set an analysis start date, you must first set a start date",
      );
    }

    if (currentStage === "running" && stopAt && !startAnalysisPeriodAt) {
      throw new BadRequestError(
        "To set a stop date, you must first set an analysis start date",
      );
    }

    // Check if the dates are consecutive
    const dateError =
      (startAt &&
        startAnalysisPeriodAt &&
        currentStage === "draft" &&
        startAt > startAnalysisPeriodAt) ||
      (startAt && stopAt && currentStage === "draft" && startAt > stopAt) ||
      (startAnalysisPeriodAt &&
        stopAt &&
        !existing.analysisStartDate &&
        startAnalysisPeriodAt > stopAt);
    if (dateError) {
      throw new BadRequestError("Scheduled dates must be consecutive");
    }
  }

  public static async getAllHoldoutsToUpdate(): Promise<
    { id: string; organization: string }[]
  > {
    const now = new Date();

    const holdouts = await getCollection<HoldoutInterface>(COLLECTION_NAME)
      .find({
        "nextScheduledStatusUpdate.date": {
          $lte: now,
          $exists: true,
          $ne: null,
        },
      })
      .project({
        id: true,
        organization: true,
      })
      .limit(100)
      .sort({ "nextScheduledStatusUpdate.date": 1 })
      .toArray();

    return holdouts.map((h) => ({ id: h.id, organization: h.organization }));
  }

  public async getAllPayloadHoldouts(
    environment?: string,
  ): Promise<
    Map<
      string,
      { holdout: HoldoutInterface; holdoutExperiment: ExperimentInterface }
    >
  > {
    const holdouts = await this._find({});
    const holdoutsWithExperiments = await Promise.all(
      holdouts.map(async (h) => {
        const holdoutExperiment = await getExperimentById(
          this.context,
          h.experimentId,
        );
        return { holdout: h, holdoutExperiment };
      }),
    );

    const filteredHoldouts = holdoutsWithExperiments.filter(
      (
        h,
      ): h is {
        holdout: HoldoutInterface;
        holdoutExperiment: ExperimentInterface;
      } => {
        if (!h.holdoutExperiment) return false;
        if (h.holdoutExperiment.archived) return false;
        if (h.holdoutExperiment.status !== "running") return false;

        if (
          Object.keys(h.holdout.linkedExperiments).length === 0 &&
          Object.keys(h.holdout.linkedFeatures).length === 0
        )
          return false;
        if (
          environment &&
          !h.holdout.environmentSettings[environment]?.enabled
        ) {
          return false;
        }
        return true;
      },
    );
    if (!filteredHoldouts || filteredHoldouts.length === 0) {
      return new Map();
    }
    return new Map(filteredHoldouts.map((h) => [h.holdout.id, h]));
  }

  public async removeExperimentFromHoldout(
    holdoutId: string,
    experimentId: string,
  ) {
    await this.mutateLinkage(holdoutId, ({ linkedExperiments }) => {
      const { [experimentId]: _, ...rest } = linkedExperiments;
      return { linkedExperiments: rest };
    });
  }

  public async removeFeatureFromHoldout(holdoutId: string, featureId: string) {
    await this.mutateLinkage(holdoutId, ({ linkedFeatures }) => {
      const { [featureId]: _, ...rest } = linkedFeatures;
      return { linkedFeatures: rest };
    });
  }

  /**
   * Returns the feature entry this call WROTE, or null when an entry was already
   * there and won the spread below. Compensation needs it: `dateAdded` is what
   * distinguishes the entry this publish added from an identical-looking one a
   * later writer put back, and without it a rewind removes whichever entry it
   * finds.
   */
  public async addFeatureToHoldout(
    holdoutId: string,
    featureId: string,
    experimentIds: string[] = [],
  ): Promise<{ id: string; dateAdded: Date } | null> {
    const entry = { id: featureId, dateAdded: new Date() };
    // Set on every attempt, so the value that survives is the one computed from
    // the row the write actually landed on — a retry that finds the feature
    // already linked must report "added nothing", not the first attempt's answer.
    let added: { id: string; dateAdded: Date } | null = null;
    await this.mutateLinkage(
      holdoutId,
      ({ linkedFeatures, linkedExperiments }) => {
        // The spread puts existing entries last, so an entry that was already
        // there wins and this call added nothing.
        added = linkedFeatures[featureId] ? null : entry;
        return {
          linkedFeatures: { [featureId]: entry, ...linkedFeatures },
          ...(experimentIds.length
            ? {
                linkedExperiments: {
                  ...Object.fromEntries(
                    experimentIds.map((experimentId) => [
                      experimentId,
                      { id: experimentId, dateAdded: new Date() },
                    ]),
                  ),
                  ...linkedExperiments,
                },
              }
            : {}),
        };
      },
      { required: true },
    );
    return added;
  }

  public async addExperimentToHoldout(holdoutId: string, experimentId: string) {
    await this.addExperimentsToHoldout(holdoutId, [experimentId]);
  }

  public async addExperimentsToHoldout(
    holdoutId: string,
    experimentIds: string[],
  ) {
    if (!experimentIds.length) return;
    const added = Object.fromEntries(
      experimentIds.map((id) => [id, { id, dateAdded: new Date() }]),
    );
    await this.mutateLinkage(
      holdoutId,
      ({ linkedExperiments }) => ({
        // Existing entries win, so re-linking keeps the original `dateAdded`.
        linkedExperiments: { ...added, ...linkedExperiments },
      }),
      { required: true },
    );
  }

  public async removeExperimentsFromHoldout(
    holdoutId: string,
    experimentIds: string[],
  ) {
    if (!experimentIds.length) return;
    const drop = new Set(experimentIds);
    await this.mutateLinkage(
      holdoutId,
      ({ linkedExperiments }) => ({
        linkedExperiments: Object.fromEntries(
          Object.entries(linkedExperiments).filter(([id]) => !drop.has(id)),
        ),
      }),
      { required: true },
    );
  }

  // Publish-rewind counterpart to `addFeatureToHoldout`: drops only the entries a
  // failed publish added, in one write, leaving entries other features
  // contributed alone. No-ops when the maps are already at the target state, so
  // rewinding a forward pass that never landed writes nothing.
  public async removeLinkageFromHoldout(
    holdoutId: string,
    {
      featureId,
      experimentIds,
      // The feature entry the caller is undoing. Presence alone is not ownership:
      // a writer who unlinked the feature and re-linked it wrote a NEW entry, and
      // removing that one undoes their work, not ours. `dateAdded` is what tells
      // the two apart, so a caller that knows what it wrote passes it and this
      // declines when live no longer matches. Omitted by callers that mean "drop
      // whatever is there" (unlinking a feature outright, not compensating).
      expectFeatureEntry,
    }: {
      featureId?: string | null;
      experimentIds?: string[];
      expectFeatureEntry?: { dateAdded: Date } | null;
    },
  ) {
    const drop = new Set(experimentIds ?? []);
    await this.mutateLinkage(holdoutId, (holdout) => {
      const linkedExperiments = Object.fromEntries(
        Object.entries(holdout.linkedExperiments).filter(
          ([id]) => !drop.has(id),
        ),
      );
      const linkedFeatures = { ...holdout.linkedFeatures };
      const liveEntry = featureId
        ? holdout.linkedFeatures[featureId]
        : undefined;
      // Decided HERE, not before the write: the `dateAdded` comparison is only
      // ownership if it describes the row being written. Deciding it against an
      // earlier read and then replacing the whole map let a relink land in between
      // and be deleted anyway — the exact ABA `dateAdded` was added to prevent,
      // just moved from "which entry" to "which moment".
      const ownsFeatureEntry =
        expectFeatureEntry === undefined ||
        (!!liveEntry &&
          !!expectFeatureEntry &&
          new Date(liveEntry.dateAdded).getTime() ===
            expectFeatureEntry.dateAdded.getTime());
      if (featureId && ownsFeatureEntry) delete linkedFeatures[featureId];

      if (
        Object.keys(linkedExperiments).length ===
          Object.keys(holdout.linkedExperiments).length &&
        Object.keys(linkedFeatures).length ===
          Object.keys(holdout.linkedFeatures).length
      ) {
        return null;
      }
      return { linkedFeatures, linkedExperiments };
    });
  }

  // Puts a feature back under the holdout it was unlinked from, with its original
  // `dateAdded`. No-ops when it is still linked.
  public async restoreFeatureLinkage(
    holdoutId: string,
    feature: { id: string; dateAdded: Date },
  ) {
    await this.mutateLinkage(holdoutId, ({ linkedFeatures }) =>
      linkedFeatures[feature.id]
        ? null
        : { linkedFeatures: { ...linkedFeatures, [feature.id]: feature } },
    );
  }

  // Bypasses read scope: the Holdout reference is already committed on the
  // Feature Flag, so linkage must not depend on the publisher seeing its Projects.
  public async getByIdForLinkage(
    holdoutId: string,
  ): Promise<HoldoutInterface | null> {
    const [holdout] = await this._find(
      { id: holdoutId },
      { bypassReadPermissionChecks: true },
    );
    return holdout ?? null;
  }

  private async getLinkageTarget(holdoutId: string): Promise<HoldoutInterface> {
    const holdout = await this.getByIdForLinkage(holdoutId);
    if (!holdout) {
      throw new NotFoundError("Holdout not found");
    }
    return holdout;
  }

  /**
   * The only way linkage is written.
   *
   * Every linkage update is a read-modify-write of a WHOLE map, so an unguarded
   * one silently drops whatever another writer put there in between — a relinked
   * feature, another feature's experiments, a compensation's restore. The CAS
   * guards both maps and re-runs `compute` against the row it will write, which is
   * also the only way an ownership test on `dateAdded` means anything.
   *
   * All three bypasses — authority, readability, licence — say the same thing: this
   * write's authority comes from the Feature Flag write that caused it, which is
   * already committed. None were enforced on the raw writer this replaces; the CAS
   * is here for atomicity, not to add gates.
   *
   * `compute` returning null means "nothing to do" and writes nothing.
   */
  private async mutateLinkage(
    holdoutId: string,
    compute: (
      holdout: HoldoutInterface,
    ) => UpdateProps<HoldoutInterface> | null,
    // Set by the link/unlink verbs, which are acting on a Holdout the caller just
    // resolved: a missing one is a real error there, where for compensation it just
    // means there is nothing left to undo.
    { required = false }: { required?: boolean } = {},
  ) {
    const updated = await this.updateWithCas(
      holdoutId,
      [...LINKAGE_FIELDS],
      compute,
      {
        dangerouslyBypassCanUpdate: true,
        dangerouslyBypassCanRead: true,
        dangerouslyBypassPremium: true,
      },
    );
    if (!updated && required) {
      const stillThere = await this.getByIdForLinkage(holdoutId);
      if (!stillThere) throw new NotFoundError("Holdout not found");
    }
    return updated;
  }
}
