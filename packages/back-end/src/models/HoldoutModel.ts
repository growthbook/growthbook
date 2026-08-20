import { HoldoutInterface, holdoutValidator } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { ExperimentInterface } from "shared/types/experiment";
import { getHoldoutStage } from "shared/util";
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

// Guarded on BOTH maps by every linkage write, even one that touches only one of
// them: they are updated together often enough (link a feature with its
// experiments, compensate a publish) that guarding half would let the other half
// be clobbered by a writer this one never saw.
const LINKAGE_FIELDS = ["linkedFeatures", "linkedExperiments"] as const;

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
