import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { createSavedQuery } from "back-end/src/models/SavedQueryModel";

export async function postSavedQuery(
  req: AuthRequest<{ query: string; results: any; name: string }, null>,
  res: Response
) {
  console.log("made it here");
  const context = getContextFromReq(req);
  const { org, userId } = context;

  const { query, results, name } = req.body;

  try {
    await createSavedQuery(org.id, userId, { query, results, name });
  } catch (e) {
    throw new Error(
      `Unable to save query. ${e.message ? `Reason: ${e.message}` : null}`
    );
  }
  return res.status(204).json();
}
