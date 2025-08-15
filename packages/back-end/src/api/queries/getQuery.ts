import { GetQueryResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getQueryValidator } from "back-end/src/validators/openapi";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";

export const getQuery = createApiRequestHandler(getQueryValidator)(async (
  req,
): Promise<GetQueryResponse> => {
  const { id } = req.params;
  const query = await getQueryById(req.context, id);
  if (!query) {
    throw new Error(`A query with id ${id} does not exist`);
  }

  return {
    query: toQueryApiInterface(query),
  };
});
