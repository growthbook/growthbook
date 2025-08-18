import { metricGroupValidator } from "back-end/src/routers/metric-group/metric-group.validators";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { ApiMetricGroup } from "back-end/types/openapi";
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
});

export class MetricGroupModel extends BaseClass {
  protected canRead(metricGroup: MetricGroupInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(
      metricGroup.projects
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

  public toMetricGroupApiInterface(
    metricGroup: MetricGroupInterface
  ): ApiMetricGroup {
    return {
      id: metricGroup.id,
      name: metricGroup.name,
      description: metricGroup.description,
      datasource: metricGroup.datasource,
      metrics: metricGroup.metrics,
      projects: metricGroup.projects,
      tags: metricGroup.tags,
      organization: metricGroup.organization,
      owner: metricGroup.owner,
      archived: metricGroup.archived,
      dateCreated: metricGroup.dateCreated?.toISOString() || "",
      dateUpdated: metricGroup.dateUpdated?.toISOString() || "",
    };
  }
}
