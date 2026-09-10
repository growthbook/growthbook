import { MetricGroupInterface } from "shared/types/metric-groups";
import { metricGroupValidator } from "shared/validators";
import { MetricInterface } from "shared/types/metric";
import { UpdateProps } from "shared/types/base-model";
import { isFactMetricId } from "shared/experiments";
import {
  isProjectListValidForProjects,
  getInvalidMetricGroupMetrics,
  getMetricGroupMetricsToValidate,
  doesMetricProjectChangeReduceGroupAvailability,
} from "shared/util";
import { metricGroupApiSpec } from "back-end/src/api/specs/metric-group.spec";
import { getMetricsByIds } from "./MetricModel";
import { touchDefinitionsVersion } from "./DefinitionsVersionModel";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: metricGroupValidator,
  collectionName: "metricgroups",
  affectsDefinitionsVersion: true,
  definitionsVersionProjectField: "projects",
  idPrefix: "mg_",
  auditLog: {
    entity: "metricGroup",
    createEvent: "metricGroup.create",
    updateEvent: "metricGroup.update",
    deleteEvent: "metricGroup.delete",
  },
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [{ fields: { organization: 1, id: 1 } }],
  defaultValues: {
    owner: "",
    tags: [],
    archived: false,
  },
  apiConfig: {
    modelKey: "metricGroups",
    openApiSpec: metricGroupApiSpec,
  },
});

export class MetricGroupModel extends BaseClass {
  protected canRead(metricGroup: MetricGroupInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(
      metricGroup.projects,
    );
  }

  protected canCreate(doc: MetricGroupInterface): boolean {
    return this.context.permissions.canCreateMetricGroup(doc);
  }

  protected canUpdate(
    doc: MetricGroupInterface,
    updates: UpdateProps<MetricGroupInterface>,
  ): boolean {
    return this.context.permissions.canUpdateMetricGroup(doc, updates);
  }

  protected canDelete(doc: MetricGroupInterface): boolean {
    return this.context.permissions.canDeleteMetricGroup(doc);
  }

  protected async customValidation(
    doc: MetricGroupInterface,
    previousDoc?: MetricGroupInterface,
  ) {
    // Allow edits to projects without validating metrics unless new metrics
    // are added or projects are changed.
    const metricIds = getMetricGroupMetricsToValidate(doc, previousDoc ?? null);
    if (!metricIds.length) return;

    const [metrics, factMetrics] = await Promise.all([
      getMetricsByIds(
        this.context,
        metricIds.filter((id) => !isFactMetricId(id)),
      ),
      this.context.models.factMetrics.getByIds(
        metricIds.filter(isFactMetricId),
      ),
    ]);
    const allMetrics = [...metrics, ...factMetrics];
    const foundIds = new Set(allMetrics.map((metric) => metric.id));
    const missingIds = metricIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      this.context.throwBadRequestError(
        `Cannot save metric group: these metrics do not exist or you do not have access to them: ${missingIds.join(", ")}.`,
      );
    }

    const invalidMetrics = getInvalidMetricGroupMetrics(
      { ...doc, metrics: metricIds },
      allMetrics,
    );
    if (invalidMetrics.length) {
      this.context.throwBadRequestError(
        doc.projects.length
          ? `Cannot save metric group because these metrics are not available in every group Project: ${invalidMetrics.join(", ")}.`
          : `Cannot save metric group for All Projects because these metrics are restricted to specific Projects: ${invalidMetrics.join(", ")}.`,
      );
    }
  }

  async validateMetricProjectChange(
    metricId: string,
    projects: MetricInterface["projects"],
    previousProjects: MetricInterface["projects"],
  ): Promise<void> {
    if (isProjectListValidForProjects(projects, previousProjects)) {
      return;
    }
    // Membership must hold even for groups the metric editor cannot read.
    const groups = await this._find(
      { metrics: metricId },
      { bypassReadPermissionChecks: true },
    );
    if (
      groups.some((group) =>
        doesMetricProjectChangeReduceGroupAvailability(
          previousProjects,
          projects,
          group.projects,
        ),
      )
    ) {
      this.context.throwBadRequestError(
        "Cannot change the metric's Projects because this would reduce its availability in a metric group that contains it. Update the group's Projects or remove the metric from the group first.",
      );
    }
  }

  findByMetric(metricId: string): Promise<MetricGroupInterface[]> {
    return this._find({
      metrics: metricId,
    });
  }

  async removeMetricFromAllGroups(metricId: string): Promise<void> {
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, metrics: metricId },
      {
        // @ts-expect-error - not sure why $pull is complaining, but it works
        $pull: { metrics: metricId },
        $set: { dateUpdated: new Date() },
      },
    );
    // Raw write bypasses the BaseModel affectsDefinitionsVersion hook.
    await touchDefinitionsVersion(this.context.org.id);
  }
}
