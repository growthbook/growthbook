import { OrganizationInterface } from "../../types/organization";
import { deleteMetricById, getMetricById } from "../models/MetricModel";
import { ImpactEstimateModel } from "../models/ImpactEstimateModel";
import { removeMetricFromExperiments } from "../models/ExperimentModel";
import { EventAuditUser } from "../events/event-types";

// TODO: Enable after merging https://github.com/growthbook/growthbook/pull/1265
// export type MetricDeleteOptions = PermissionFunctions & {
export type MetricDeleteOptions = {
  id: string;
  organization: OrganizationInterface;
  eventAudit: EventAuditUser;
};

export class MetricDeleter {
  private readonly options: MetricDeleteOptions;

  constructor(options: MetricDeleteOptions) {
    this.options = options;
  }

  public async perform(): Promise<string> {
    const { id, organization, eventAudit } = this.options;

    // TODO: Enable after merging https://github.com/growthbook/growthbook/pull/1265
    //  checkPermissions("createAnalyses", "");

    const metric = await getMetricById(id, organization.id);
    // TODO: Enable after merging https://github.com/growthbook/growthbook/pull/1265
    // checkPermissions(
    //   "createMetrics",
    //   metric?.projects?.length ? metric.projects : ""
    // );
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

    return metric.id;
  }
}
