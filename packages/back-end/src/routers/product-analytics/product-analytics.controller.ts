import type { Response } from "express";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
  UserJourneyConfig,
  UserJourney,
  UserJourneyPathRow,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { NotFoundError } from "back-end/src/util/errors";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { getQueryById } from "back-end/src/models/QueryModel";

// Stub path rows for postUserJourneyRun: single step (steps 0 → 1). Scalable shape: steps[] + unit_count + optional timing.
const STUB_SINGLE_STEP_ROWS: UserJourneyPathRow[] = [
  {
    steps: ["Session Start", "*"],
    unit_count: 44319,
    avg_secs_between_steps: [0],
  },
  {
    steps: ["Session Start", "Page View: /features"],
    unit_count: 2092,
    avg_secs_between_steps: [50.04],
  },
  {
    steps: ["Session Start", "Page View: /experiments"],
    unit_count: 469,
    avg_secs_between_steps: [83.17],
  },
  {
    steps: ["Session Start", "Page View: /setup"],
    unit_count: 957,
    avg_secs_between_steps: [3.62],
  },
  {
    steps: ["Session Start", "Page View: /features/[fid]"],
    unit_count: 676,
    avg_secs_between_steps: [104.98],
  },
  {
    steps: ["Session Start", "Modal Open: setup-growthbook"],
    unit_count: 526,
    avg_secs_between_steps: [1.61],
  },
  {
    steps: ["Session Start", "Page View: /experiment/[eid]"],
    unit_count: 388,
    avg_secs_between_steps: [149.94],
  },
  {
    steps: ["Session Start", "Page View: /sdks"],
    unit_count: 287,
    avg_secs_between_steps: [64.43],
  },
];

// Stub path rows added when extending from "Page View: /features" (step 2 → step 3 only). Retain STUB_SINGLE_STEP_ROWS and append these.
const STUB_EXTENDED_ROWS: UserJourneyPathRow[] = [
  {
    steps: [
      "Session Start",
      "Page View: /features",
      "Page View: /features/[fid]",
    ],
    unit_count: 12870,
    avg_secs_between_steps: [37.86, 42.75],
  },
  {
    steps: ["Session Start", "Page View: /features", "Viewed Feature Modal"],
    unit_count: 1961,
    avg_secs_between_steps: [40.32, 69.48],
  },
  {
    steps: ["Session Start", "Page View: /features", "Page View: /experiments"],
    unit_count: 1597,
    avg_secs_between_steps: [52.73, 48.81],
  },
  {
    steps: [
      "Session Start",
      "Page View: /features",
      "Feature Environment Toggle",
    ],
    unit_count: 797,
    avg_secs_between_steps: [30.31, 100.94],
  },
  {
    steps: ["Session Start", "Page View: /features", "Page View: /features"],
    unit_count: 711,
    avg_secs_between_steps: [31.74, 459.51],
  },
];

function buildStubUserJourney(
  context: { org: { id: string } },
  config: UserJourneyConfig,
  resultRows: UserJourneyPathRow[],
  id: string,
): UserJourney {
  const now = new Date();
  const dateStart = new Date();
  dateStart.setDate(dateStart.getDate() - 30);
  const dateEnd = new Date();
  return {
    id,
    organization: context.org.id,
    dateCreated: now,
    dateUpdated: now,
    config,
    result: { rows: resultRows },
    dateStart: dateStart.toISOString(),
    dateEnd: dateEnd.toISOString(),
    runStarted: now,
    status: "success",
    error: null,
    queries: [],
  };
}

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
  const _context = getContextFromReq(req);
  const _id = req.params.id;

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
    userJourney: UserJourney;
  }>,
) => {
  const context = getContextFromReq(req);

  // Stub: return single-step path data. Replace with runUserJourney(context, req.body.config) when ready.
  const userJourney = buildStubUserJourney(
    context,
    req.body.config,
    STUB_SINGLE_STEP_ROWS,
    "uj_stub_run_1",
  );

  return res.status(200).json({
    status: 200,
    userJourney,
  });
};

export const extendUserJourney = async (
  req: AuthRequest<
    { config: UserJourneyConfig; pathToExtend: string[]; stepToExtend: number },
    { id: string },
    { cache?: "preferred" | "required" | "never" }
  >,
  res: Response<{
    status: 200;
    userJourney: UserJourney;
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  // Stub: retain all rows from steps leading up to and including the step we extended from (STUB_SINGLE_STEP_ROWS),
  // and append the new step's rows (STUB_EXTENDED_ROWS). Replace with real extend logic when ready.
  const userJourney = buildStubUserJourney(
    context,
    req.body.config,
    [...STUB_SINGLE_STEP_ROWS, ...STUB_EXTENDED_ROWS],
    id,
  );

  return res.status(200).json({
    status: 200,
    userJourney,
  });
};
