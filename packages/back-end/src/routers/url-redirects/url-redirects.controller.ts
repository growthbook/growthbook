import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  CreateURLRedirectProps,
  URLRedirectInterface,
  UpdateURLRedirectProps,
} from "../../../types/url-redirect";

export const postURLRedirect = async (
  req: AuthRequest<
    CreateURLRedirectProps,
    null,
    { circularDependencyCheck?: string }
  >,
  res: Response<{ status: 200; urlRedirect: URLRedirectInterface }>
) => {
  const context = getContextFromReq(req);
  const { circularDependencyCheck } = req.query;

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
  res: Response<{ status: 200; urlRedirect: URLRedirectInterface }>
) => {
  const context = getContextFromReq(req);
  const { circularDependencyCheck } = req.query;

  const urlRedirect = await context.models.urlRedirects.updateById(
    req.params.id,
    req.body,
    { checkCircularDependencies: circularDependencyCheck === "true" }
  );

  res.status(200).json({
    status: 200,
    urlRedirect,
  });
};

export const deleteURLRedirect = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  await context.models.urlRedirects.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};
