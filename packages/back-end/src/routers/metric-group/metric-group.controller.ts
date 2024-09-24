import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  CreateMetricGroupProps,
  MetricGroupInterface,
} from "../../../types/metric-groups";
import {
  createMetricGroup,
  deleteMetricGroupById,
  getAllMetricGroupsForOrganization,
  getMetricGroupById,
  updateMetricGroup,
} from "../../models/MetricGroupModel";

export const getMetricGroups = async (
  req: AuthRequest,
  res: Response<{ status: 200; metricGroups: MetricGroupInterface[] }>
) => {
  const context = getContextFromReq(req);

  const metricGroups = await getAllMetricGroupsForOrganization(context.org.id);

  // do we need to add a filter to filter out metric groups that the user does not have access to in this project?
  res.status(200).json({
    status: 200,
    metricGroups,
  });
};

export const postMetricGroup = async (
  req: AuthRequest<CreateMetricGroupProps>,
  res: Response<{ status: 200; metricGroup: MetricGroupInterface }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateMetricGroup()) {
    context.permissions.throwPermissionError();
  }
  const metricGroup = await createMetricGroup(context, data);

  res.status(200).json({
    status: 200,
    metricGroup,
  });
};

export const putMetricGroup = async (
  req: AuthRequest<CreateMetricGroupProps, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const metricGroup = await getMetricGroupById(context, req.params.id);
  if (!metricGroup) {
    throw new Error("Could not find metric group with that id");
  }

  if (!context.permissions.canUpdateMetricGroup()) {
    context.permissions.throwPermissionError();
  }

  await updateMetricGroup(context, metricGroup.id, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteMetricGroup = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const metricGroup = await getMetricGroupById(context, req.params.id);
  if (!metricGroup) {
    throw new Error("Could not find metric group with that id");
  }

  if (!context.permissions.canDeleteMetricGroup()) {
    context.permissions.throwPermissionError();
  }

  await deleteMetricGroupById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};

// reorder metrics within a group
export const putMetricGroupReorder = async (
  req: AuthRequest<{ from: number; to: number }, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const { id } = req.params;
  const metricGroup = await getMetricGroupById(context, req.params.id);
  if (!metricGroup) {
    throw new Error("Could not find metric group with that id");
  }
  if (!context.permissions.canUpdateMetricGroup()) {
    context.permissions.throwPermissionError();
  }
  const { from, to } = req.body;

  const existingMetrics = metricGroup.metrics;
  const [removed] = existingMetrics.splice(from, 1);
  existingMetrics.splice(to, 0, removed);

  await updateMetricGroup(context, id, { metrics: existingMetrics });

  res.status(200).json({
    status: 200,
  });
};

// remove a metric from a group
export const removeMetricFromGroup = async (
  req: AuthRequest<null, { id: string; metricId: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const { id, metricId } = req.params;
  const metricGroup = await getMetricGroupById(context, id);
  if (!metricGroup) {
    throw new Error("Could not find metric group with that id");
  }
  if (!context.permissions.canUpdateMetricGroup()) {
    context.permissions.throwPermissionError();
  }

  const existingMetrics = metricGroup.metrics;
  const index = existingMetrics.indexOf(metricId);
  if (index === -1) {
    throw new Error("Could not find metric in group");
  }
  existingMetrics.splice(index, 1);

  await updateMetricGroup(context, id, { metrics: existingMetrics });

  res.status(200).json({
    status: 200,
  });
};
