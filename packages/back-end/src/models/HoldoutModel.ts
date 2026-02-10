import { HoldoutInterface, holdoutValidator } from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { getCollection } from "back-end/src/util/mongo.util";
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
  globallyUniqueIds: false,
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
    updates: HoldoutInterface,
  ): boolean {
    return this.context.permissions.canUpdateHoldout(existing, updates);
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
    const holdoutExperiment = await getExperimentById(
      this.context,
      existing.experimentId,
    );
    if (!holdoutExperiment) {
      throw new Error("Holdout experiment not found");
    }

    const now = new Date();

    // Check if one of the scheduled dates is in the past
    if (
      updates.scheduledStatusUpdates?.startAt &&
      new Date(updates.scheduledStatusUpdates.startAt) < now
    ) {
      throw new Error("Scheduled start date cannot be in the past");
    }
    if (
      updates.scheduledStatusUpdates?.startAnalysisPeriodAt &&
      new Date(updates.scheduledStatusUpdates.startAnalysisPeriodAt) < now
    ) {
      throw new Error("Scheduled analysis start date cannot be in the past");
    }
    if (
      updates.scheduledStatusUpdates?.stopAt &&
      new Date(updates.scheduledStatusUpdates.stopAt) < now
    ) {
      throw new Error("Scheduled stop date cannot be in the past");
    }

    // Check date dependencies
    if (
      holdoutExperiment.status === "draft" &&
      updates.scheduledStatusUpdates?.stopAt &&
      (!updates.scheduledStatusUpdates?.startAt ||
        !updates.scheduledStatusUpdates?.startAnalysisPeriodAt)
    ) {
      throw new Error(
        "To set a stop date, you must also set a start date and an analysis start date",
      );
    }
    if (
      holdoutExperiment.status === "draft" &&
      updates.scheduledStatusUpdates?.startAnalysisPeriodAt &&
      !updates.scheduledStatusUpdates?.startAt
    ) {
      throw new Error(
        "To set an analysis start date, you must first set a start date",
      );
    }

    if (
      holdoutExperiment.status === "running" &&
      !existing.analysisStartDate &&
      updates.scheduledStatusUpdates?.stopAt &&
      !updates.scheduledStatusUpdates?.startAnalysisPeriodAt
    ) {
      throw new Error(
        "To set a stop date, you must first set an analysis start date",
      );
    }

    // Check if the dates are consecutive
    const dateError =
      (updates.scheduledStatusUpdates?.startAt &&
        updates.scheduledStatusUpdates?.startAnalysisPeriodAt &&
        holdoutExperiment.status === "draft" &&
        updates.scheduledStatusUpdates?.startAt >
          updates.scheduledStatusUpdates?.startAnalysisPeriodAt) ||
      (updates.scheduledStatusUpdates?.startAt &&
        updates.scheduledStatusUpdates?.stopAt &&
        holdoutExperiment.status === "draft" &&
        updates.scheduledStatusUpdates?.startAt >
          updates.scheduledStatusUpdates?.stopAt) ||
      (updates.scheduledStatusUpdates?.startAnalysisPeriodAt &&
        updates.scheduledStatusUpdates?.stopAt &&
        !existing.analysisStartDate &&
        updates.scheduledStatusUpdates?.startAnalysisPeriodAt >
          updates.scheduledStatusUpdates?.stopAt);
    if (dateError) {
      throw new Error("Scheduled dates must be consecutive");
    }
  }

  public static async getAllHoldoutsToUpdate(): Promise<
    { id: string; organization: string }[]
  > {
    const now = new Date();

    const holdouts = await getCollection<HoldoutInterface>(COLLECTION_NAME)
      .find({
        nextScheduledUpdate: { $lte: now, $exists: true },
      })
      .project({
        id: true,
        organization: true,
      })
      .limit(100)
      .sort({ nextScheduledUpdate: 1 })
      .toArray();

    return holdouts.map((h) => ({ id: h.id, organization: h.organization }));
  }

  public async getAllPayloadHoldouts(
    environment?: string,
  ): Promise<
    Map<string, { holdout: HoldoutInterface; experiment: ExperimentInterface }>
  > {
    const holdouts = await this._find({});
    const holdoutsWithExperiments = await Promise.all(
      holdouts.map(async (h) => {
        const experiment = await getExperimentById(
          this.context,
          h.experimentId,
        );
        return { holdout: h, experiment };
      }),
    );

    const filteredHoldouts = holdoutsWithExperiments.filter(
      (
        h,
      ): h is {
        holdout: HoldoutInterface;
        experiment: ExperimentInterface;
      } => {
        if (!h.experiment) return false;
        if (h.experiment.archived) return false;
        if (h.experiment.status !== "running") return false;

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
    const holdout = await this.getById(holdoutId);
    if (!holdout) {
      throw new Error("Holdout not found");
    }
    const { [experimentId]: _, ...linkedExperiments } =
      holdout.linkedExperiments;
    await this.updateById(holdoutId, { linkedExperiments });
  }

  public async removeFeatureFromHoldout(holdoutId: string, featureId: string) {
    const holdout = await this.getById(holdoutId);
    if (!holdout) {
      throw new Error("Holdout not found");
    }
    const { [featureId]: _, ...linkedFeatures } = holdout.linkedFeatures;
    await this.updateById(holdoutId, { linkedFeatures });
  }
}
