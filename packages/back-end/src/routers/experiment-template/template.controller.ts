import type { Response } from "express";
import { z } from "zod";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { EventUserForResponseLocals } from "back-end/src/events/event-types";
import { PrivateApiErrorResponse } from "back-end/types/api";
import {
  createTemplateValidator,
  ExperimentTemplateInterface,
} from "./template.validators";

export type CreateTemplateProps = z.infer<typeof createTemplateValidator>;

// region POST /Templates

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
  const { template } = req.body;

  if (!context.permissions.canCreateExperimentTemplate(template)) {
    context.permissions.throwPermissionError();
  }
  const { templateMetadata } = req.body.template;

  const doc = await context.models.experimentTemplates.create(template);

  res.status(200).json({
    status: 200,
    template: doc,
  });
};
