import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { CustomHookInterface } from "back-end/src/routers/custom-hooks/custom-hooks.validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { CreateProps, UpdateProps } from "back-end/types/models";
import { IS_CLOUD } from "back-end/src/util/secrets";

export const getCustomHooks = async (
  req: AuthRequest,
  res: Response<{
    status: 200;
    customHooks: CustomHookInterface[];
  }>,
) => {
  const context = getContextFromReq(req);

  // Cloud or non-enterprise gets an empty list
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) {
    res.status(200).json({
      status: 200,
      customHooks: [],
    });
    return;
  }

  const customHooks = await context.models.customHooks.getAll();

  res.status(200).json({
    status: 200,
    customHooks,
  });
};

export const createCustomHook = async (
  req: AuthRequest<CreateProps<CustomHookInterface>>,
  res: Response<{
    status: 200;
    customHook: CustomHookInterface;
  }>,
) => {
  const context = getContextFromReq(req);

  // Cloud or non-enterprise gets an error
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) {
    throw new Error("Not allowed");
  }

  const customHook = await context.models.customHooks.create(req.body);

  res.status(200).json({
    status: 200,
    customHook,
  });
};

export const updateCustomHook = async (
  req: AuthRequest<UpdateProps<CustomHookInterface>, { id: string }>,
  res: Response<{
    status: 200;
    customHook: CustomHookInterface;
  }>,
) => {
  const context = getContextFromReq(req);

  // Cloud or non-enterprise gets an error
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) {
    throw new Error("Not allowed");
  }

  const customHook = await context.models.customHooks.updateById(
    req.params.id,
    req.body,
  );

  res.status(200).json({
    status: 200,
    customHook,
  });
};

export const deleteCustomHook = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
  }>,
) => {
  const context = getContextFromReq(req);

  // Cloud or non-enterprise gets an error
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) {
    throw new Error("Not allowed");
  }

  await context.models.customHooks.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};
