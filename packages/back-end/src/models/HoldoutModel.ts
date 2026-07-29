import { HoldoutInterface, holdoutValidator } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { ExperimentInterface } from "shared/types/experiment";
import { getCollection } from "back-end/src/util/mongo.util";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { MakeModelClass } from "./BaseModel";
import { getExperimentById } from "./ExperimentModel";

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
});

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
    const holdout = await this.getLinkageTarget(holdoutId);
    await this.writeLinkage(holdout, {
      linkedExperiments: {
        ...holdout.linkedExperiments,
        [experimentId]: { id: experimentId, dateAdded: new Date() },
      },
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
