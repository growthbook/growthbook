import { z } from "zod";
import { getHoldoutStage, stringToBoolean } from "shared/util";
import {
  ApiHoldoutInterface,
  apiCreateHoldoutBody,
  apiHoldoutStageReturn,
  apiUpdateHoldoutBody,
  coverageToHoldoutSize,
  DEFAULT_HOLDOUT_SIZE,
  holdoutSizeToCoverage,
  HOLDOUT_API_EXPERIMENT_UPDATE_FIELDS,
  HOLDOUT_API_TARGETING_UPDATE_FIELDS,
  HOLDOUT_API_UPDATE_FIELDS,
  HoldoutInterface,
  holdoutValidator,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { ExperimentInterface } from "shared/types/experiment";
import { getCollection } from "back-end/src/util/mongo.util";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  holdoutApiSpec,
  holdoutStageEndpoint,
} from "back-end/src/api/specs/holdout.spec";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  advanceHoldoutStage,
  applyHoldoutTargetingChanges,
  createHoldoutWithExperiment,
  normalizeHoldoutScheduleUpdates,
} from "back-end/src/services/holdouts";
import {
  resolveOwnerEmail,
  resolveOwnerEmails,
  resolveOwnerForCreate,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { MakeModelClass } from "./BaseModel";
import {
  getExperimentById,
  getExperimentsByIds,
  updateExperiment,
} from "./ExperimentModel";

const COLLECTION_NAME = "holdouts";

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
        ...holdoutStageEndpoint,
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiHoldoutStageReturn>> => {
          const holdout = await req.context.models.holdout.getById(
            req.params.id,
          );
          if (!holdout) {
            return req.context.throwNotFoundError();
          }
          const experiment = await getExperimentById(
            req.context,
            holdout.experimentId,
          );
          if (!experiment) {
            return req.context.throwNotFoundError(
              "Holdout experiment not found",
            );
          }

          const envs = getEnvironmentIdsFromOrg(req.context.org);
          if (!req.context.permissions.canRunHoldout(holdout, envs)) {
            req.context.permissions.throwPermissionError();
          }

          await advanceHoldoutStage(req.context, {
            holdout,
            experiment,
            stage: req.body.stage,
          });

          // Re-read both documents: the stage change rewrote the experiment's
          // status and phases and the holdout's analysis/schedule fields.
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
        },
      }),
    ],
  },
});

/**
 * Merges a holdout and its companion experiment into the public API shape.
 *
 * The experiment is nullable because a holdout can outlive a deleted experiment;
 * in that case the experiment-derived fields fall back to empty values rather
 * than failing the whole response.
 */
export function toApiHoldout(
  holdout: HoldoutInterface,
  experiment: ExperimentInterface | null,
): ApiHoldoutInterface {
  const phase = experiment?.phases?.[experiment.phases.length - 1];
  const firstPhase = experiment?.phases?.[0];

  return {
    id: holdout.id,
    dateCreated: holdout.dateCreated.toISOString(),
    dateUpdated: holdout.dateUpdated.toISOString(),
    name: holdout.name,
    description: experiment?.description ?? "",
    projects: holdout.projects,
    owner: experiment?.owner ?? "",
    tags: experiment?.tags ?? [],
    archived: experiment?.archived ?? false,
    stage: experiment
      ? getHoldoutStage(holdout, experiment)
      : /* No experiment left to derive from. */ "stopped",
    experimentId: holdout.experimentId,
    trackingKey: experiment?.trackingKey ?? "",
    skipAsDefaultHoldout: holdout.skipAsDefaultHoldout ?? false,

    holdoutSize: coverageToHoldoutSize(phase?.coverage ?? 0),
    hashAttribute: experiment?.hashAttribute ?? "",
    targetingCondition: phase?.condition ?? "",
    savedGroups: phase?.savedGroups,

    datasourceId: experiment?.datasource ?? "",
    assignmentQueryId: experiment?.exposureQueryId ?? "",
    goalMetrics: experiment?.goalMetrics ?? [],
    secondaryMetrics: experiment?.secondaryMetrics ?? [],
    guardrailMetrics: experiment?.guardrailMetrics ?? [],
    activationMetric: experiment?.activationMetric || undefined,
    variations: (experiment?.variations ?? []).map((v) => ({
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
      experiment?.status === "stopped"
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

  protected toApiInterface(doc: HoldoutInterface): ApiHoldoutInterface {
    // Only reached if a caller bypasses the overrides below. Returning the
    // holdout half alone is better than throwing, and every handler here
    // resolves the experiment properly.
    return toApiHoldout(doc, null);
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
      // A holdout whose experiment was deleted cannot be filtered on
      // experiment-derived fields, so drop it from filtered listings.
      if (!experiment) {
        if (datasourceId || stage || wantArchived !== undefined) continue;
        results.push(toApiHoldout(holdout, null));
        continue;
      }
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
        datasource: body.datasourceId,
        exposureQueryId: body.assignmentQueryId,
        // An empty hash attribute would leave the Holdout unable to bucket
        // anyone, so fall back to the conventional default.
        hashAttribute: body.hashAttribute || "id",
        goalMetrics: body.goalMetrics,
        secondaryMetrics: body.secondaryMetrics,
        guardrailMetrics: body.guardrailMetrics,
        activationMetric: body.activationMetric,
        environmentSettings: body.environments
          ? Object.fromEntries(
              Object.entries(body.environments).map(([id, settings]) => [
                id,
                { enabled: settings.enabled },
              ]),
            )
          : undefined,
        // A new holdout gets a single phase holding its targeting and sizing.
        phases: [
          {
            name: "Holdout",
            reason: "",
            dateStarted: new Date().toISOString(),
            coverage: holdoutSizeToCoverage(
              body.holdoutSize ?? DEFAULT_HOLDOUT_SIZE,
            ),
            condition: body.targetingCondition ?? "",
            savedGroups: body.savedGroups,
            variationWeights: [0.5, 0.5],
            variations: [],
          },
        ],
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
    let experiment = await this.getExperimentOrThrow(holdout);

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

    const isTargetingChange = HOLDOUT_API_TARGETING_UPDATE_FIELDS.some(
      (field) => body[field] !== undefined,
    );

    // Targeting and sizing changes reach live SDK payloads, so they additionally
    // require run permission on the Holdout's environments — the same bar the
    // internal targeting endpoint applies.
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

    // 1. Phase-level targeting and sizing, through the same path the internal
    //    targeting endpoint uses so phases and the SDK payload stay correct.
    if (isTargetingChange) {
      experiment = await applyHoldoutTargetingChanges(this.context, {
        experiment,
        coverage:
          body.holdoutSize === undefined
            ? undefined
            : holdoutSizeToCoverage(body.holdoutSize),
        condition: body.targetingCondition,
        savedGroups: body.savedGroups,
        hashAttribute: body.hashAttribute,
      });
    }

    // 2. Metadata and analysis settings on the companion experiment.
    const experimentChanges: Partial<ExperimentInterface> = {};
    for (const field of HOLDOUT_API_EXPERIMENT_UPDATE_FIELDS) {
      if (body[field] !== undefined) {
        (experimentChanges as Record<string, unknown>)[field] = body[field];
      }
    }
    if (body.owner !== undefined) {
      experimentChanges.owner = await resolveOwnerToUserId(
        body.owner,
        this.context,
      );
    }
    if (body.datasourceId !== undefined) {
      experimentChanges.datasource = body.datasourceId;
    }
    if (body.assignmentQueryId !== undefined) {
      experimentChanges.exposureQueryId = body.assignmentQueryId;
    }
    // A holdout's two variations are fixed, so only their labels can change.
    if (body.variations) {
      const renames = new Map(body.variations.map((v) => [v.variationId, v]));
      experimentChanges.variations = experiment.variations.map((v) => {
        const rename = renames.get(v.id);
        if (!rename) return v;
        return {
          ...v,
          name: rename.name ?? v.name,
          description: rename.description ?? v.description,
        };
      });
    }
    // The name is stored on both documents and must not drift.
    if (body.name !== undefined) {
      experimentChanges.name = body.name;
    }
    if (Object.keys(experimentChanges).length) {
      experiment = await updateExperiment({
        context: this.context,
        experiment,
        changes: experimentChanges,
      });
    }

    // 3. Fields on the holdout document itself.
    const holdoutUpdates: UpdateProps<HoldoutInterface> = {};
    for (const field of HOLDOUT_API_UPDATE_FIELDS) {
      if (body[field] !== undefined) {
        (holdoutUpdates as Record<string, unknown>)[field] = body[field];
      }
    }
    if (body.name !== undefined) {
      holdoutUpdates.name = body.name;
    }
    if (body.environments !== undefined) {
      holdoutUpdates.environmentSettings = Object.fromEntries(
        Object.entries(body.environments).map(([id, settings]) => [
          id,
          { enabled: settings.enabled },
        ]),
      );
    }
    if (body.statusUpdateSchedule !== undefined) {
      Object.assign(
        holdoutUpdates,
        normalizeHoldoutScheduleUpdates({
          holdout,
          experiment,
          scheduleInput: body.statusUpdateSchedule,
        }),
      );
    }

    const updated = Object.keys(holdoutUpdates).length
      ? await this.update(holdout, holdoutUpdates)
      : holdout;

    return resolveOwnerEmail(toApiHoldout(updated, experiment), this.context);
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

    // Check if one of the scheduled dates is in the past
    if (
      startAt &&
      holdoutExperiment.status === "draft" &&
      new Date(startAt) < now
    ) {
      throw new BadRequestError("Scheduled start date cannot be in the past");
    }
    if (
      startAnalysisPeriodAt &&
      holdoutExperiment.status === "running" &&
      !existing.analysisStartDate &&
      new Date(startAnalysisPeriodAt) < now
    ) {
      throw new BadRequestError(
        "Scheduled analysis start date cannot be in the past",
      );
    }
    if (
      stopAt &&
      holdoutExperiment.status !== "stopped" &&
      new Date(stopAt) < now
    ) {
      throw new BadRequestError("Scheduled stop date cannot be in the past");
    }

    // Check date dependencies
    if (
      holdoutExperiment.status === "draft" &&
      stopAt &&
      (!startAt || !startAnalysisPeriodAt)
    ) {
      throw new BadRequestError(
        "To set a stop date, you must also set a start date and an analysis start date",
      );
    }
    if (
      holdoutExperiment.status === "draft" &&
      startAnalysisPeriodAt &&
      !startAt
    ) {
      throw new BadRequestError(
        "To set an analysis start date, you must first set a start date",
      );
    }

    if (
      holdoutExperiment.status === "running" &&
      !existing.analysisStartDate &&
      stopAt &&
      !startAnalysisPeriodAt
    ) {
      throw new BadRequestError(
        "To set a stop date, you must first set an analysis start date",
      );
    }

    // Check if the dates are consecutive
    const dateError =
      (startAt &&
        startAnalysisPeriodAt &&
        holdoutExperiment.status === "draft" &&
        startAt > startAnalysisPeriodAt) ||
      (startAt &&
        stopAt &&
        holdoutExperiment.status === "draft" &&
        startAt > stopAt) ||
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
    const holdout = await this.getLinkageTarget(holdoutId);
    const { [experimentId]: _, ...linkedExperiments } =
      holdout.linkedExperiments;
    await this.writeLinkage(holdout, { linkedExperiments });
  }

  public async removeFeatureFromHoldout(holdoutId: string, featureId: string) {
    const holdout = await this.getLinkageTarget(holdoutId);
    const { [featureId]: _, ...linkedFeatures } = holdout.linkedFeatures;
    await this.writeLinkage(holdout, { linkedFeatures });
  }

  public async addFeatureToHoldout(
    holdoutId: string,
    featureId: string,
    experimentIds: string[] = [],
  ) {
    const holdout = await this.getLinkageTarget(holdoutId);
    await this.writeLinkage(holdout, {
      linkedFeatures: {
        [featureId]: { id: featureId, dateAdded: new Date() },
        ...holdout.linkedFeatures,
      },
      ...(experimentIds.length
        ? {
            linkedExperiments: {
              ...Object.fromEntries(
                experimentIds.map((experimentId) => [
                  experimentId,
                  { id: experimentId, dateAdded: new Date() },
                ]),
              ),
              ...holdout.linkedExperiments,
            },
          }
        : {}),
    });
  }

  public async addExperimentToHoldout(holdoutId: string, experimentId: string) {
    await this.addExperimentsToHoldout(holdoutId, [experimentId]);
  }

  public async addExperimentsToHoldout(
    holdoutId: string,
    experimentIds: string[],
  ) {
    if (!experimentIds.length) return;
    const holdout = await this.getLinkageTarget(holdoutId);
    const added = Object.fromEntries(
      experimentIds.map((id) => [id, { id, dateAdded: new Date() }]),
    );
    await this.writeLinkage(holdout, {
      // Existing entries win, so re-linking keeps the original `dateAdded`.
      linkedExperiments: { ...added, ...holdout.linkedExperiments },
    });
  }

  public async removeExperimentsFromHoldout(
    holdoutId: string,
    experimentIds: string[],
  ) {
    if (!experimentIds.length) return;
    const holdout = await this.getLinkageTarget(holdoutId);
    const drop = new Set(experimentIds);
    await this.writeLinkage(holdout, {
      linkedExperiments: Object.fromEntries(
        Object.entries(holdout.linkedExperiments).filter(
          ([id]) => !drop.has(id),
        ),
      ),
    });
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
    }: { featureId?: string | null; experimentIds?: string[] },
  ) {
    const holdout = await this.getByIdForLinkage(holdoutId);
    if (!holdout) return;

    const drop = new Set(experimentIds ?? []);
    const linkedExperiments = Object.fromEntries(
      Object.entries(holdout.linkedExperiments).filter(([id]) => !drop.has(id)),
    );
    const linkedFeatures = { ...holdout.linkedFeatures };
    if (featureId) delete linkedFeatures[featureId];

    if (
      Object.keys(linkedExperiments).length ===
        Object.keys(holdout.linkedExperiments).length &&
      Object.keys(linkedFeatures).length ===
        Object.keys(holdout.linkedFeatures).length
    ) {
      return;
    }
    await this.writeLinkage(holdout, { linkedFeatures, linkedExperiments });
  }

  // Puts a feature back under the holdout it was unlinked from, with its original
  // `dateAdded`. No-ops when it is still linked.
  public async restoreFeatureLinkage(
    holdoutId: string,
    feature: { id: string; dateAdded: Date },
  ) {
    const holdout = await this.getByIdForLinkage(holdoutId);
    if (!holdout || holdout.linkedFeatures[feature.id]) return;
    await this.writeLinkage(holdout, {
      linkedFeatures: { ...holdout.linkedFeatures, [feature.id]: feature },
    });
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

  // A side effect of an authorized Feature Flag write, so flag authority is
  // enough — gating on `createAnalyses` fails mid-publish for flag publishers.
  private async writeLinkage(
    holdout: HoldoutInterface,
    updates: UpdateProps<HoldoutInterface>,
  ) {
    await this.dangerousUpdateBypassPermission(holdout, updates);
  }
}
