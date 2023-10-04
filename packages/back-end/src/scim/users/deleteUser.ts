import { Response } from "express";

export async function deleteUser(res: Response) {
  // SCIM requires that we have a /user/delete endpoint, but given a user can belong to multiple orgs, we don't want to actually delete the user from the DB
  return res.status(204);
}
