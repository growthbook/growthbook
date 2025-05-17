import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { QueryInterface } from "back-end/types/query";
import { getQueryById } from "back-end/src/models/QueryModel";

type GetQueryResponse = {
  status: 200;
  query: QueryInterface;
};

export const getQuery = async (
  req: AuthRequest<null, { id: string }, null>,
  res: Response<GetQueryResponse>
) => {
  const { org } = getContextFromReq(req);

  const { id } = req.params;

  const query = await getQueryById(org.id, id);

  if (!query) {
    throw new Error("Could not find query");
  }

  return res.status(200).json({
    status: 200,
    query,
  });
};
