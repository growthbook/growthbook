import { z } from "zod";
import {
  apiContextualBanditQueryValidator,
  apiCreateContextualBanditQueryBody,
  apiListContextualBanditQueriesValidator,
  apiUpdateContextualBanditQueryBody,
} from "../validators/contextual-bandit-query";

/**
 * Every REST route under `/api/v1/contextual-bandit-queries`. Each export is
 * one route, named after its operationId. The back-end must mount every export
 * (see contextual-bandit-queries.router.ts), so nothing else belongs in this file.
 */

const tags = ["ContextualBanditQueries"];
const idParams = z.object({ id: z.string() }).strict();

export const getContextualBanditQuery = {
  paramsSchema: idParams,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({
    contextualBanditQuery: apiContextualBanditQueryValidator,
  }),
  summary: "Get a single contextualBanditQuery",
  operationId: "getContextualBanditQuery",
  tags,
  method: "get" as const,
  path: "/contextual-bandit-queries/:id",
};

export const createContextualBanditQuery = {
  paramsSchema: z.never(),
  bodySchema: apiCreateContextualBanditQueryBody,
  querySchema: z.never(),
  responseSchema: z.object({
    contextualBanditQuery: apiContextualBanditQueryValidator,
  }),
  summary: "Create a single contextualBanditQuery",
  operationId: "createContextualBanditQuery",
  tags,
  method: "post" as const,
  path: "/contextual-bandit-queries",
};

export const listContextualBanditQueries = {
  ...apiListContextualBanditQueriesValidator,
  responseSchema: z.object({
    contextualBanditQueries: z.array(apiContextualBanditQueryValidator),
  }),
  summary: "Get all contextualBanditQueries",
  operationId: "listContextualBanditQueries",
  tags,
  method: "get" as const,
  path: "/contextual-bandit-queries",
};

export const deleteContextualBanditQuery = {
  paramsSchema: idParams,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({ deletedId: z.string() }),
  summary: "Delete a single contextualBanditQuery",
  operationId: "deleteContextualBanditQuery",
  tags,
  method: "delete" as const,
  path: "/contextual-bandit-queries/:id",
};

export const updateContextualBanditQuery = {
  paramsSchema: idParams,
  bodySchema: apiUpdateContextualBanditQueryBody,
  querySchema: z.never(),
  responseSchema: z.object({
    contextualBanditQuery: apiContextualBanditQueryValidator,
  }),
  summary: "Update a single contextualBanditQuery",
  operationId: "updateContextualBanditQuery",
  tags,
  method: "put" as const,
  path: "/contextual-bandit-queries/:id",
};
