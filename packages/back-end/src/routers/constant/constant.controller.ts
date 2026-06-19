import type { Response } from "express";
import { z } from "zod";
import {
  postConstantBodyValidator,
  putConstantBodyValidator,
} from "shared/validators";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

type PostConstantBody = z.infer<typeof postConstantBodyValidator>;
type PutConstantBody = z.infer<typeof putConstantBodyValidator>;

// GET /constants — value-omitted projection (values can be large; the full
// value is fetched per-constant via GET /constants/:id).
export const getConstants = async (
  req: AuthRequest,
  res: Response<{ status: 200; constants: ConstantWithoutValue[] }>,
) => {
  const context = getContextFromReq(req);
  const constants = await context.models.constants.getAllWithoutValues();
  return res.status(200).json({ status: 200, constants });
};

// GET /constants/:id — full constant (includes values).
export const getConstantById = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; constant: ConstantInterface }>,
) => {
  const context = getContextFromReq(req);
  const constant = await context.models.constants.getById(req.params.id);
  if (!constant) {
    return context.throwNotFoundError("Constant not found");
  }
  return res.status(200).json({ status: 200, constant });
};

export const postConstant = async (
  req: AuthRequest<PostConstantBody>,
  res: Response<{ status: 200; constant: ConstantInterface }>,
) => {
  const context = getContextFromReq(req);
  const body = req.body;
  // Permission is enforced by the model's canCreate.
  const constant = await context.models.constants.create({
    key: body.key,
    name: body.name,
    owner: body.owner ?? "",
    type: body.type,
    defaultValue: body.defaultValue,
    environmentValues: body.environmentValues,
    description: body.description,
    projects: body.projects,
  });
  return res.status(200).json({ status: 200, constant });
};

export const putConstant = async (
  req: AuthRequest<PutConstantBody, { id: string }>,
  res: Response<{ status: 200; constant: ConstantInterface }>,
) => {
  const context = getContextFromReq(req);
  const existing = await context.models.constants.getById(req.params.id);
  if (!existing) {
    return context.throwNotFoundError("Constant not found");
  }
  const constant = await context.models.constants.update(existing, req.body);
  return res.status(200).json({ status: 200, constant });
};

export const deleteConstant = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const existing = await context.models.constants.getById(req.params.id);
  if (!existing) {
    return context.throwNotFoundError("Constant not found");
  }
  await context.models.constants.delete(existing);
  return res.status(200).json({ status: 200 });
};
