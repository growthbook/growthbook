import type { Response } from "express";
import {
  CreatePowerCalculationBody,
  PowerCalculationInterface,
  UpdatePowerCalculationBody,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

type GetPowerCalculationResponse = {
  status: 200;
  powerCalculation: PowerCalculationInterface;
};

export const getPowerCalculation = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<GetPowerCalculationResponse>,
) => {
  const context = getContextFromReq(req);
  const doc = await context.models.powerCalculations.getById(req.params.id);
  if (!doc) {
    return context.throwNotFoundError(
      "Could not find power calculation with that id",
    );
  }
  return res.status(200).json({
    status: 200,
    powerCalculation: doc,
  });
};

type PostPowerCalculationResponse = {
  status: 200;
  powerCalculation: PowerCalculationInterface;
};

export const postPowerCalculation = async (
  req: AuthRequest<CreatePowerCalculationBody>,
  res: Response<PostPowerCalculationResponse>,
) => {
  const context = getContextFromReq(req);
  const { name, description, owner, project, inputs } = req.body;

  const doc = await context.models.powerCalculations.create({
    name,
    description,
    owner,
    project,
    inputs,
  });

  return res.status(200).json({
    status: 200,
    powerCalculation: doc,
  });
};

type PutPowerCalculationResponse = {
  status: 200;
  powerCalculation: PowerCalculationInterface;
};

export const putPowerCalculation = async (
  req: AuthRequest<UpdatePowerCalculationBody, { id: string }>,
  res: Response<PutPowerCalculationResponse>,
) => {
  const context = getContextFromReq(req);
  const existing = await context.models.powerCalculations.getById(
    req.params.id,
  );
  if (!existing) {
    return context.throwNotFoundError(
      "Could not find power calculation with that id",
    );
  }

  const updated = await context.models.powerCalculations.update(
    existing,
    req.body,
  );

  return res.status(200).json({
    status: 200,
    powerCalculation: updated,
  });
};

type DeletePowerCalculationResponse = { status: 200 };

export const deletePowerCalculation = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<DeletePowerCalculationResponse>,
) => {
  const context = getContextFromReq(req);
  const existing = await context.models.powerCalculations.getById(
    req.params.id,
  );
  if (!existing) {
    return context.throwNotFoundError(
      "Could not find power calculation with that id",
    );
  }
  await context.models.powerCalculations.delete(existing);
  return res.status(200).json({ status: 200 });
};
