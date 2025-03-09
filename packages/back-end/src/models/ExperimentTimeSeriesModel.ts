import {
  CreateExperimentTimeSeries,
  ExperimentTimeSeries,
  experimentTimeSeries,
} from "back-end/src/validators/experiment-time-series";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: experimentTimeSeries,
  collectionName: "experimenttimeseries",
  idPrefix: "expts_",
  // TODO(adriel): Do we need audit logs for this given it'll be automatically managed?
  auditLog: {
    entity: "experimentTimeSeries",
    createEvent: "experimentTimeSeries.create",
    updateEvent: "experimentTimeSeries.update",
    deleteEvent: "experimentTimeSeries.delete",
  },
});

export class ExperimentTimeSeriesModel extends BaseClass {
  protected canCreate(doc: ExperimentTimeSeries): boolean {
    const experiment = this.getForeignRefs(doc).experiment;
    if (!experiment) {
      return false;
    }
    return this.context.permissions.canCreateExperimentTimeSeries(experiment);
  }

  protected canRead(doc: ExperimentTimeSeries): boolean {
    return this.canCreate(doc);
  }

  protected canUpdate(doc: ExperimentTimeSeries): boolean {
    return this.canCreate(doc);
  }

  protected canDelete(doc: ExperimentTimeSeries): boolean {
    return this.canCreate(doc);
  }

  public async createOrUpdate(
    doc: CreateExperimentTimeSeries
  ): Promise<ExperimentTimeSeries> {
    const existing = await this.findByExperimentAndPhase(
      doc.experiment,
      doc.phase
    );
    if (existing) {
      return this.update(existing, doc);
    } else {
      return super.create(doc);
    }
  }

  public async findByExperimentAndPhase(
    experimentId: string,
    phase: number
  ): Promise<ExperimentTimeSeries | null> {
    return this._findOne({ experiment: experimentId, phase });
  }
}
