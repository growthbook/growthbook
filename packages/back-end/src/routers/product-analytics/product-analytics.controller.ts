import type { Response } from "express";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
  UserJourneyConfig,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { NotFoundError } from "back-end/src/util/errors";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { getQueryById } from "back-end/src/models/QueryModel";

export const postProductAnalyticsRun = async (
  req: AuthRequest<
    { config: ExplorationConfig },
    unknown,
    { cache?: "preferred" | "required" | "never" }
  >,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration | null;
    query: QueryInterface | null;
  }>,
) => {
  const context = getContextFromReq(req);

  const exploration = await runProductAnalyticsExploration(
    context,
    req.body.config,
    { cache: req.query.cache },
  );

  const queryId = exploration?.queries?.[0]?.query;
  const query = queryId ? await getQueryById(context, queryId) : null;

  return res.status(200).json({
    status: 200,
    exploration,
    query,
  });
};

export const getExplorationById = async (
  req: AuthRequest<never, { id: string }, never>,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const exploration = await context.models.analyticsExplorations.getById(id);
  if (!exploration) {
    throw new NotFoundError("Exploration not found");
  }

  const queryId = exploration?.queries?.[0]?.query;
  const query = queryId ? await getQueryById(context, queryId) : null;

  return res.status(200).json({
    status: 200,
    exploration,
    query,
  });
};

export const getUserJourneyById = async (
  req: AuthRequest<never, { id: string }, never>,
  res: Response<{
    status: 200;
    // Polish return types
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  // Fetch user journey by id
  // Fetch query?
  // return user journey and query

  return res.status(200).json({
    status: 200,
  });
};

export const postUserJourneyRun = async (
  req: AuthRequest<
    { config: UserJourneyConfig },
    unknown,
    { cache?: "preferred" | "required" | "never" }
  >,
  res: Response<{
    status: 200;
    // Polish return types
  }>,
) => {
  const context = getContextFromReq(req);

  // Get the user journey by calling the query runner with the config
  // const userJourney = await runUserJourney(context, req.body.config);
  // Return the user journey

  return res.status(200).json({
    status: 200,
  });
};

export const extendUserJourney = async (
  req: AuthRequest<
    { config: UserJourneyConfig; pathToExtend: string[]; stepToExtend: number },
    unknown,
    { cache?: "preferred" | "required" | "never" }
  >,
  res: Response<{
    status: 200;
    // Polish return types
  }>,
) => {
  const context = getContextFromReq(req);

  // Extend the user journey by calling the query runner with the config
  // const userJourney = await extendUserJourney(context, req.body.config);
  // Return the user journey

  return res.status(200).json({
    status: 200,
  });
};
