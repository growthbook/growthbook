import type { Response } from "express";
import { z } from "zod";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { EventUserForResponseLocals } from "back-end/src/events/event-types";
import { PrivateApiErrorResponse } from "back-end/types/api";
import { SafeRolloutSnapshotInterface } from "back-end/src/validators/safe-rollout";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { SafeRolloutResultsQueryRunner } from "back-end/src/queryRunners/SafeRolloutResultsQueryRunner";
import {
  createTemplateValidator,
  ExperimentTemplateInterface,
  UpdateTemplateProps,
} from "./template.validators";

// TODO: Delete this once we have a real endpoint for this
export const createSnapshot = async (
  req: AuthRequest,
  res: Response<{ status: 200; snapshot: SafeRolloutSnapshotInterface }>
) => {
  const context = getContextFromReq(req);
  const datasource = await getDataSourceById(context, "ds_2izgf19hmlp1x2cyi");
  if (!datasource) {
    throw new Error("Could not load data source");
  }

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  const snapshot = await context.models.safeRolloutSnapshots.getById(
    "srsnp_1l7r12dnm83gh76w"
  );

  if (!snapshot) {
    throw new Error("Could not load safe rollout snapshot model");
  }

  const integration = getSourceIntegrationObject(context, datasource, true);
  const useCache = false;

  const queryRunner = new SafeRolloutResultsQueryRunner(
    context,
    snapshot,
    integration,
    useCache
  );

  await queryRunner.startAnalysis({
    metricMap,
    factTableMap,
  });

  return res.status(200).json({
    status: 200,
    snapshot,
  });
};

export const getTemplates = async (
  req: AuthRequest,
  res: Response<{ status: 200; templates: ExperimentTemplateInterface[] }>
) => {
  const context = getContextFromReq(req);

  const templates = await context.models.experimentTemplates.getAll();

  const filteredTemplates = templates.filter((t) => {
    return context.permissions.canReadSingleProjectResource(t.project);
  });

  res.status(200).json({
    status: 200,
    templates: filteredTemplates,
  });
};

export type CreateTemplateProps = z.infer<typeof createTemplateValidator>;

// region POST /templates

type CreateTemplateResponse = {
  status: 200;
  template: ExperimentTemplateInterface;
};

/**
 * POST /Templates
 * Create a Template resource
 * @param req
 * @param res
 */
export const postTemplate = async (
  req: AuthRequest<CreateTemplateProps>,
  res: Response<
    CreateTemplateResponse | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const template = req.body;

  if (!orgHasPremiumFeature(context.org, "templates")) {
    return res.status(403).json({
      status: 403,
      message:
        "Organization does not have premium feature: Experiment Templates",
    });
  }

  if (!context.permissions.canCreateExperimentTemplate(template)) {
    context.permissions.throwPermissionError();
  }

  const doc = await context.models.experimentTemplates.create({
    ...template,
    owner: userId,
  });

  res.status(200).json({
    status: 200,
    template: doc,
  });
};

// endregion POST /templates

/**
 * DELETE /Templates/:id
 * Delete a Template resource
 * @param req
 * @param res
 */
export const deleteTemplate = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const template = await context.models.experimentTemplates.getById(
    req.params.id
  );
  if (!template) {
    throw new Error("Could not find template with that id");
  }
  if (!context.permissions.canDeleteExperimentTemplate(template)) {
    context.permissions.throwPermissionError();
  }

  await context.models.experimentTemplates.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};

/**
 * PUT /Templates/:id
 * Update a Template resource
 * @param req
 * @param res
 */
export const putTemplate = async (
  req: AuthRequest<UpdateTemplateProps, { id: string }>,
  res: Response<{ status: 200; template: ExperimentTemplateInterface }>
) => {
  const context = getContextFromReq(req);
  const templateUpdates = req.body;

  const existingTemplate = await context.models.experimentTemplates.getById(
    req.params.id
  );
  if (!existingTemplate) {
    throw new Error("Could not find template with that id");
  }
  if (
    !context.permissions.canUpdateExperimentTemplate(
      existingTemplate,
      templateUpdates
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const updatedTemplate = await context.models.experimentTemplates.updateById(
    req.params.id,
    templateUpdates
  );

  res.status(200).json({
    status: 200,
    template: updatedTemplate,
  });
};
