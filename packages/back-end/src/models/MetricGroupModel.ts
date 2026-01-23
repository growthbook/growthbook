import { MetricGroupInterface } from "shared/types/metric-groups";
import { metricGroupValidator } from "shared/validators";
import { UpdateFilter } from "mongodb";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: metricGroupValidator,
  collectionName: "metricgroups",
  idPrefix: "mg_",
  auditLog: {
    entity: "metricGroup",
    createEvent: "metricGroup.create",
    updateEvent: "metricGroup.update",
    deleteEvent: "metricGroup.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [{ fields: { organization: 1, id: 1 } }],
  defaultValues: {
    owner: "",
    tags: [],
    archived: false,
  },
});

export class MetricGroupModel extends BaseClass {
  protected canRead(metricGroup: MetricGroupInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(
      metricGroup.projects,
    );
  }

  protected canCreate(): boolean {
    return this.context.permissions.canCreateMetricGroup();
  }

  protected canUpdate(): boolean {
    return this.context.permissions.canUpdateMetricGroup();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canDeleteMetricGroup();
  }

  findByMetric(metricId: string): Promise<MetricGroupInterface[]> {
    return this.getAll({
      metrics: metricId,
    });
  }

  async removeMetricFromAllGroups(metricId: string): Promise<void> {
    const pullOperation: UpdateFilter<MetricGroupInterface> = {
      metrics: metricId,
    };
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, metrics: metricId },
      { $pull: pullOperation },
    );
  }
}
