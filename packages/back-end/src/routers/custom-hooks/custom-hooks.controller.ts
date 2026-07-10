import type { Response } from "express";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { CustomHookEntityType, CustomHookInterface } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { getFeature } from "back-end/src/models/FeatureModel";

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

  const data = { ...req.body };
  // Feature-scoped hooks derive scope from the feature; keep projects empty.
  if (data.entityType && data.entityId) {
    data.projects = [];
  }

  const customHook = await context.models.customHooks.create(data);

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
    {
      functionBody: string;
      functionArgs: Record<string, unknown>;
      entityType?: CustomHookEntityType;
      entityId?: string;
    },
    null
  >,
  res: Response<{
    status: 200;
    success: boolean;
    returnVal?: string;
    error?: string;
    warnings?: string[];
    log?: string;
  }>,
) => {
  const context = getContextFromReq(req);

  // Cloud or non-enterprise gets an error
  // They should never even see the front-end page, so this is just a sanity check
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) {
    throw new Error("Not allowed");
  }

  const { entityType, entityId } = req.body;
  if (entityType === "feature" && entityId) {
    // Feature-scoped test: authorize against the target feature
    const feature = await getFeature(context, entityId);
    if (!feature || !context.permissions.canManageFeatureCustomHooks(feature)) {
      context.permissions.throwPermissionError();
    }
  } else if (entityType === "savedGroup" && entityId) {
    // Saved-group-scoped test: authorize against the target saved group
    const savedGroup = await context.models.savedGroups.getById(entityId);
    if (
      !savedGroup ||
      !context.permissions.canManageSavedGroupCustomHooks(savedGroup)
    ) {
      context.permissions.throwPermissionError();
    }
  } else if (!context.permissions.canCreateCustomHook({ projects: [] })) {
    context.permissions.throwPermissionError();
  }

  const result = await runInSandbox(
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
      warnings: result.warnings,
      log: result.log,
    });
  } else {
    res.status(200).json({
      status: 200,
      success: false,
      error: result.error || "Unknown error",
      warnings: result.warnings,
      log: result.log,
    });
  }
};
