import { FilterQuery, PipelineStage } from "mongoose";
import omit from "lodash/omit";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  experimentSnapshotSchema,
} from "back-end/src/validators/experiment-snapshot";
import {
  LegacyExperimentSnapshotInterface,
  SnapshotType,
} from "back-end/types/experiment-snapshot";
import { migrateSnapshot } from "back-end/src/util/migrations";
import { notifyExperimentChange } from "back-end/src/services/experimentNotifications";
import { updateExperimentAnalysisSummary } from "back-end/src/services/experiments";
import { MakeModelClass, UpdateProps } from "./BaseModel";
import { getExperimentById } from "./ExperimentModel";

export type AddOrUpdateSnapshotAnalysisParams = {
  id: string;
  analysis: ExperimentSnapshotAnalysis;
};

const BaseClass = MakeModelClass({
  schema: experimentSnapshotSchema,
  collectionName: "experimentsnapshots",
  idPrefix: "snp_",
  auditLog: {
    entity: "experimentSnapshot",
    createEvent: "experimentSnapshot.create",
    updateEvent: "experimentSnapshot.update",
    deleteEvent: "experimentSnapshot.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        experiment: 1,
        dateCreated: -1,
      },
    },
  ],
});

export const getDefaultAnalysisResults = (
  snapshot: ExperimentSnapshotInterface
) => snapshot.analyses?.[0]?.results?.[0];

export class ExperimentSnapshotModel extends BaseClass {
  // CRUD permission checks
  protected canRead(doc: ExperimentSnapshotInterface): boolean {
    const { experiment } = this.getForeignRefs(doc);

    return this.context.permissions.canReadSingleProjectResource(
      experiment?.project
    );
  }
  protected canCreate(doc: ExperimentSnapshotInterface): boolean {
    // const { datasource, experiment } = this.getForeignRefs(doc);

    // if (!datasource) {
    //   throw new Error(
    //     `Could not find datasource for this experiment snapshot (datasource id: ${experiment?.datasource})`
    //   );
    // }

    // return this.context.permissions.canCreateExperimentSnapshot(datasource);
    return true;
  }
  protected canUpdate(existing: ExperimentSnapshotInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: ExperimentSnapshotInterface): boolean {
    return this.canCreate(doc);
  }

  protected async afterUpdate(
    _existing: ExperimentSnapshotInterface,
    _updates: UpdateProps<ExperimentSnapshotInterface>,
    newDoc: ExperimentSnapshotInterface
  ) {
    const shouldUpdateExperimentAnalysisSummary =
      newDoc.type === "standard" && newDoc.status === "success";

    if (shouldUpdateExperimentAnalysisSummary) {
      const experimentModel = await getExperimentById(
        this.context,
        newDoc.experiment
      );

      const isLatestPhase = experimentModel
        ? newDoc.phase === experimentModel.phases.length - 1
        : false;

      if (experimentModel && isLatestPhase) {
        await updateExperimentAnalysisSummary({
          context: this.context,
          experiment: experimentModel,
          experimentSnapshot: newDoc,
        });
      }
    }

    await notifyExperimentChange({ context: this.context, snapshot: newDoc });
  }

  protected async afterCreate(doc: ExperimentSnapshotInterface) {
    await notifyExperimentChange({ context: this.context, snapshot: doc });
  }

  public async findRunningByQueryId(ids: string[]) {
    // Only look for matches in the past 24 hours to make the query more efficient
    // Older snapshots should not still be running anyway
    const earliestDate = new Date();
    earliestDate.setDate(earliestDate.getDate() - 1);

    const snapshots = await super._find({
      status: "running",
      dateCreated: { $gt: earliestDate },
      queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
    });

    return snapshots.map((doc) => this.migrate(doc));
  }

  public async updateOnPhaseDelete(experiment: string, phase: number) {
    const snapshotCollection = await super._dangerousGetCollection();
    const organization = this.context.org.id;
    // Delete all snapshots for the phase
    await snapshotCollection.deleteMany({
      organization,
      experiment,
      phase,
    });

    // Decrement the phase index for all later phases
    await snapshotCollection.updateMany(
      {
        organization,
        experiment,
        phase: {
          $gt: phase,
        },
      },
      {
        $inc: {
          phase: -1,
        },
      }
    );
  }

  public async updateSnapshotAnalysis({
    id,
    analysis,
  }: {
    id: string;
    analysis: ExperimentSnapshotAnalysis;
  }) {
    const snapshotCollection = await super._dangerousGetCollection();
    const organization = this.context.org.id;

    await snapshotCollection.updateOne(
      {
        organization,
        id,
        "analyses.settings": analysis.settings,
      },
      {
        $set: { "analyses.$": analysis },
      }
    );

    const experimentSnapshotModel = await snapshotCollection.findOne({
      id,
      organization,
    });
    if (!experimentSnapshotModel) throw "Internal error";

    // Not notifying on new analysis because new analyses in an existing snapshot
    // are akin to ad-hoc snapshots
    // await notifyExperimentChange({
    //   context,
    //   snapshot: experimentSnapshotModel,
    // });
  }

  public async addOrUpdateSnapshotAnalysis(
    params: AddOrUpdateSnapshotAnalysisParams
  ) {
    const { id, analysis } = params;
    const organization = this.context.org.id;
    const snapshotCollection = await super._dangerousGetCollection();
    // looks for snapshots with this ID but WITHOUT these analysis settings
    const experimentSnapshotModel = await snapshotCollection.updateOne(
      {
        organization,
        id,
        "analyses.settings": { $ne: analysis.settings },
      },
      {
        $push: { analyses: analysis },
      }
    );
    // if analysis already exist, no documents will be returned by above query
    // so instead find and update existing analysis in DB
    if (experimentSnapshotModel.matchedCount === 0) {
      await this.updateSnapshotAnalysis({ id, analysis });
    }
  }

  public async findLatestRunningByReportId(report: string) {
    // Only look for match in the past 24 hours to make the query more efficient
    // Older snapshots should not still be running anyway
    const earliestDate = new Date();
    earliestDate.setDate(earliestDate.getDate() - 1);

    const snapshot = await super._findOne({
      report,
      status: "running",
      dateCreated: { $gt: earliestDate },
      queries: { $elemMatch: { status: "running" } },
    });

    return snapshot ? this.migrate(snapshot) : null;
  }

  public async getLatestSnapshot({
    experiment,
    phase,
    dimension,
    beforeSnapshot,
    withResults = true,
    type,
  }: {
    experiment: string;
    phase: number;
    dimension?: string;
    beforeSnapshot?: ExperimentSnapshotInterface;
    withResults?: boolean;
    type?: SnapshotType;
  }) {
    const query: FilterQuery<ExperimentSnapshotInterface> = {
      experiment,
      phase,
      dimension: dimension || null,
    };
    if (type) {
      query.type = type;
    } else {
      // never include report types unless specifically looking for them
      query.type = { $ne: "report" };
    }

    // First try getting new snapshots that have a `status` field
    let all = await super._find(
      {
        ...query,
        status: {
          $in: withResults ? ["success"] : ["success", "running", "error"],
        },
        ...(beforeSnapshot
          ? { dateCreated: { $lt: beforeSnapshot.dateCreated } }
          : {}),
      },
      {
        sort: { dateCreated: -1 },
        limit: 1,
      }
    );
    if (all[0]) {
      return this.migrate(all[0]);
    }

    // Otherwise, try getting old snapshot records
    if (withResults) {
      query.results = { $exists: true, $type: "array", $ne: [] };
    }

    all = await super._find(query, {
      sort: { dateCreated: -1 },
      limit: 1,
    });

    return all[0] ? this.migrate(all[0]) : null;
  }

  // Gets latest snapshots per experiment-phase pair
  public async getLatestSnapshotMultipleExperiments(
    experimentPhaseMap: Map<string, number>,
    dimension?: string,
    withResults: boolean = true
  ): Promise<ExperimentSnapshotInterface[]> {
    const experimentPhasesToGet = new Map(experimentPhaseMap);
    const query: FilterQuery<ExperimentSnapshotInterface> = {
      experiment: { $in: Array.from(experimentPhasesToGet.keys()) },
      dimension: dimension || null,
      ...(withResults
        ? {
            $or: [
              { status: "success" },
              // get old snapshots if status field is missing
              { results: { $exists: true, $type: "array", $ne: [] } },
            ],
          }
        : {}),
    };

    const aggregatePipeline: PipelineStage[] = [
      // find all snapshots for those experiments matching dimension and result status
      { $match: query },
      // sort so latest is first
      { $sort: { dateCreated: -1 } },
      // group by experiment-phase and call latest snapshot `latestSnapshot`
      {
        $group: {
          _id: { experiment: "$experiment", phase: "$phase" },
          latestSnapshot: { $first: "$$ROOT" },
        },
      },
      // take latest snapshot and put it at the top level so we return an array of snapshots
      {
        $replaceRoot: { newRoot: "$latestSnapshot" },
      },
    ];

    const snapshotCollection = await super._dangerousGetCollection();

    const all = await snapshotCollection
      .aggregate<ExperimentSnapshotInterface>(aggregatePipeline)
      .toArray();

    const snapshots: ExperimentSnapshotInterface[] = [];
    if (all[0]) {
      // get interfaces matching the right phase
      all.forEach((doc) => {
        // aggregate returns document directly, no need for toJSON
        const snapshot = this.migrate(omit(doc, ["__v", "_id"]));
        const desiredPhase = experimentPhaseMap.get(snapshot.experiment);
        if (desiredPhase !== undefined && snapshot.phase === desiredPhase) {
          snapshots.push(snapshot);
          experimentPhasesToGet.delete(snapshot.experiment);
        }
      });
    }

    const filtered = await this.filterByReadPermissions(snapshots);

    return filtered;
  }

  protected migrate(legacySnapshot: unknown): ExperimentSnapshotInterface {
    return migrateSnapshot(legacySnapshot as LegacyExperimentSnapshotInterface);
  }

  // TODO: Implement this for OpenAPI
  //   public toApiInterface(project: ProjectInterface): ApiProject {
  //     return {
  //       id: project.id,
  //       name: project.name,
  //     };
  //   }
}
