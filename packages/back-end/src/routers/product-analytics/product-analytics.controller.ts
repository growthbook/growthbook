import type { Response } from "express";
import {
  ProductAnalyticsConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { stringToBoolean } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { NotFoundError } from "back-end/src/util/errors";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";

export const postProductAnalyticsRun = async (
  req: AuthRequest<
    { config: ProductAnalyticsConfig },
    unknown,
    { skipCache?: string }
  >,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration;
  }>,
) => {
  const context = getContextFromReq(req);
  const skipCache = stringToBoolean(req.query.skipCache);

  const exploration = await runProductAnalyticsExploration(
    context,
    req.body.config,
    { skipCache },
  );

  return res.status(200).json({
    status: 200,
    exploration,
  });
};

export const getExplorationById = async (
  req: AuthRequest<never, { id: string }, never>,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration;
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const exploration = await context.models.analyticsExplorations.getById(id);
  if (!exploration) {
    throw new NotFoundError("Exploration not found");
  }

  return res.status(200).json({
    status: 200,
    exploration,
  });
};
