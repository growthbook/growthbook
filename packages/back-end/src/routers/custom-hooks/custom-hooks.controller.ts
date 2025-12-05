import type { Response } from "express";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { CustomHookInterface } from "shared/src/validators/custom-hooks";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { sandboxEval } from "back-end/src/enterprise/sandbox/sandbox-eval";

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

export const testCustomHook = async (
  req: AuthRequest<
    { functionBody: string; functionArgs: Record<string, unknown> },
    null
  >,
  res: Response<{
    status: 200;
    success: boolean;
    returnVal?: string;
    error?: string;
    log?: string;
  }>,
) => {
  const context = getContextFromReq(req);

  // Cloud or non-enterprise gets an error
  // They should never even see the front-end page, so this is just a sanity check
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) {
    throw new Error("Not allowed");
  }
  if (!context.permissions.canCreateCustomHook({ projects: [] })) {
    context.permissions.throwPermissionError();
  }

  const result = await sandboxEval(
    req.body.functionBody,
    req.body.functionArgs,
  );

  if (result.ok) {
    res.status(200).json({
      status: 200,
      success: true,
      returnVal: result.returnVal
        ? JSON.stringify(result.returnVal, null, 2)
        : undefined,
      log: result.log,
    });
  } else {
    res.status(200).json({
      status: 200,
      success: false,
      error: result.error || "Unknown error",
      log: result.log,
    });
  }
};
