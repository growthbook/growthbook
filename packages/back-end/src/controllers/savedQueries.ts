import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";

export async function getSavedQueries(req: AuthRequest, res: Response) {
  res.status(200).json({
    status: 200,
  });
}

export async function getSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  res.status(200).json({
    status: 200,
  });
}

export async function postSavedQuery(
  req: AuthRequest<{
    name: string;
    description?: string;
    sql: string;
    datasourceId: string;
    projects?: string[];
    tags?: string[];
  }>,
  res: Response
) {
  res.status(200).json({
    status: 200,
  });
}

export async function putSavedQuery(
  req: AuthRequest<
    {
      name?: string;
      description?: string;
      sql?: string;
      datasourceId?: string;
      projects?: string[];
      tags?: string[];
    },
    { id: string }
  >,
  res: Response
) {
  res.status(200).json({
    status: 200,
  });
}

export async function deleteSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  res.status(200).json({
    status: 200,
  });
}
