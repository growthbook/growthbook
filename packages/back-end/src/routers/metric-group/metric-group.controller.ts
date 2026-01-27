import type { Response } from "express";
import {
  CreateMetricGroupProps,
  MetricGroupInterface,
} from "shared/types/metric-groups";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { removeMetricFromExperiments } from "back-end/src/models/ExperimentModel";

export const getMetricGroups = async (
  req: AuthRequest,
  res: Response<{ status: 200; metricGroups: MetricGroupInterface[] }>,
) => {
  const context = getContextFromReq(req);

  const metricGroups = await context.models.metricGroups.getAll();
  res.status(200).json({
    status: 200,
    metricGroups,
  });
};

export const postMetricGroup = async (
  req: AuthRequest<CreateMetricGroupProps>,
  res: Response<{ status: 200; metricGroup: MetricGroupInterface }>,
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateMetricGroup()) {
    context.permissions.throwPermissionError();
  }

  const datasourceDoc = await getDataSourceById(context, data.datasource);
  if (!datasourceDoc) {
    context.throwBadRequestError("Invalid data source");
  }

  const baseMetricGroup: Omit<
    MetricGroupInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  > = {
    ...data,
    owner: data.owner || "",
    description: data.description || "",
    tags: data.tags || [],
    projects: data.projects || [],
    archived: data.archived || false,
  };

  const doc = await context.models.metricGroups.create(baseMetricGroup);

  res.status(200).json({
    status: 200,
    metricGroup: doc,
  });
};

export const putMetricGroup = async (
  req: AuthRequest<CreateMetricGroupProps, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const data = req.body;
  const context = getContextFromReq(req);
  const { org } = context;

  const metricGroup = await context.models.metricGroups.getById(req.params.id);
  if (!metricGroup) {
    return context.throwNotFoundError(
      "Could not find metric group with that id",
    );
  }
  if (org.id !== metricGroup.organization) {
    context.permissions.throwPermissionError(
      "You don't have access to that metric group",
    );
  }

  if (!context.permissions.canUpdateMetricGroup()) {
    context.permissions.throwPermissionError();
  }

  const datasourceDoc = await getDataSourceById(
    context,
    data?.datasource || metricGroup.datasource,
  );
  if (!datasourceDoc) {
    context.throwBadRequestError("Invalid data source");
  }
  await context.models.metricGroups.updateById(req.params.id, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteMetricGroup = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canDeleteMetricGroup()) {
    context.permissions.throwPermissionError();
  }

  const metricGroup = await context.models.metricGroups.getById(req.params.id);

  if (!metricGroup) {
    return context.throwNotFoundError("Could not find the metric group");
  }

  // should we delete all references to this metric group in the experiments?
  await removeMetricFromExperiments(context, metricGroup.id);

  await context.models.metricGroups.delete(metricGroup);

  res.status(200).json({
    status: 200,
  });
};

// reorder metrics within a group
export const putMetricGroupReorder = async (
  req: AuthRequest<{ from: number; to: number }, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const { id } = req.params;
  const metricGroup = await context.models.metricGroups.getById(req.params.id);
  if (!metricGroup) {
    return context.throwNotFoundError(
      "Could not find metric group with that id",
    );
  }
  if (!context.permissions.canUpdateMetricGroup()) {
    context.permissions.throwPermissionError();
  }
  if (metricGroup.organization !== context.org.id) {
    context.permissions.throwPermissionError(
      "You don't have access to that metric group",
    );
  }

  const { from, to } = req.body;

  const existingMetrics = metricGroup.metrics;
  const [removed] = existingMetrics.splice(from, 1);
  existingMetrics.splice(to, 0, removed);

  await context.models.metricGroups.updateById(id, {
    metrics: existingMetrics,
  });

  res.status(200).json({
    status: 200,
  });
};

// remove a metric from a group
export const removeMetricFromGroup = async (
  req: AuthRequest<null, { id: string; metricId: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const { id, metricId } = req.params;
  const metricGroup = await context.models.metricGroups.getById(req.params.id);
  if (!metricGroup) {
    return context.throwNotFoundError(
      "Could not find metric group with that id",
    );
  }
  if (!context.permissions.canUpdateMetricGroup()) {
    context.permissions.throwPermissionError();
  }
  if (metricGroup.organization !== context.org.id) {
    context.permissions.throwPermissionError(
      "You don't have access to that metric group",
    );
  }

  const existingMetrics = metricGroup.metrics;
  const index = existingMetrics.indexOf(metricId);
  if (index === -1) {
    context.throwBadRequestError("Could not find metric in group");
  }
  existingMetrics.splice(index, 1);

  await context.models.metricGroups.updateById(id, {
    metrics: existingMetrics,
  });

  res.status(200).json({
    status: 200,
  });
};
