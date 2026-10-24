import type { Response } from "express";
import {
  CreateURLRedirectProps,
  URLRedirectInterface,
  UpdateURLRedirectProps,
} from "shared/types/url-redirect";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { assertScheduledStartAllows } from "back-end/src/services/experimentChanges/scheduledStartLock";

async function assertExperimentRedirectsChangeable(
  context: ReqContext,
  experimentId: string,
) {
  const experiment = await getExperimentById(context, experimentId);
  if (experiment) assertScheduledStartAllows(experiment, "URL Redirects");
}

async function assertRedirectChangeable(context: ReqContext, id: string) {
  const urlRedirect = await context.models.urlRedirects.getById(id);
  if (urlRedirect) {
    await assertExperimentRedirectsChangeable(context, urlRedirect.experiment);
  }
}

export const postURLRedirect = async (
  req: AuthRequest<
    CreateURLRedirectProps,
    null,
    { circularDependencyCheck?: string }
  >,
  res: Response<{ status: 200; urlRedirect: URLRedirectInterface }>,
) => {
  const context = getContextFromReq(req);
  const { circularDependencyCheck } = req.query;
  await assertExperimentRedirectsChangeable(context, req.body.experiment);

  const urlRedirect = await context.models.urlRedirects.create(req.body, {
    checkCircularDependencies: circularDependencyCheck === "true",
  });

  res.status(200).json({
    status: 200,
    urlRedirect,
  });
};

export const putURLRedirect = async (
  req: AuthRequest<
    UpdateURLRedirectProps,
    { id: string },
    { circularDependencyCheck?: string }
  >,
  res: Response<{ status: 200; urlRedirect: URLRedirectInterface }>,
) => {
  const context = getContextFromReq(req);
  const { circularDependencyCheck } = req.query;
  await assertRedirectChangeable(context, req.params.id);

  const urlRedirect = await context.models.urlRedirects.updateById(
    req.params.id,
    req.body,
    { checkCircularDependencies: circularDependencyCheck === "true" },
  );

  res.status(200).json({
    status: 200,
    urlRedirect,
  });
};

export const deleteURLRedirect = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  await assertRedirectChangeable(context, req.params.id);

  await context.models.urlRedirects.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};
