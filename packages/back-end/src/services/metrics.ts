import { OrganizationInterface } from "../../types/organization";
import { deleteMetricById, getMetricById } from "../models/MetricModel";
import { ImpactEstimateModel } from "../models/ImpactEstimateModel";
import { removeMetricFromExperiments } from "../models/ExperimentModel";
import { EventAuditUser } from "../events/event-types";
import { PermissionFunctions } from "../types/AuthRequest";
import { MetricInterface } from "../../types/metric";

export type MetricDeleteOptions = PermissionFunctions & {
  id: string;
  organization: OrganizationInterface;
  eventAudit: EventAuditUser;
};

export class MetricDeleter {
  private readonly options: MetricDeleteOptions;

  constructor(options: MetricDeleteOptions) {
    this.options = options;
  }

  public async perform(): Promise<MetricInterface> {
    const { id, organization, eventAudit, checkPermissions } = this.options;

    checkPermissions("createAnalyses", "");

    const metric = await getMetricById(id, organization.id);
    checkPermissions(
      "createMetrics",
      metric?.projects?.length ? metric.projects : ""
    );
    if (!metric) {
      throw new Error("Unable to delete - Could not find metric with that id");
    }

    // delete references:
    // ideas (impact estimate)
    ImpactEstimateModel.updateMany(
      {
        metric: metric.id,
        organization: organization.id,
      },
      { metric: "" }
    );

    // Experiments
    await removeMetricFromExperiments(metric.id, organization, eventAudit);

    await deleteMetricById(metric.id, organization.id);

    return metric;
  }
}
