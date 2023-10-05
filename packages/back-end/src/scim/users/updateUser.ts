import { Request } from "express";
import { ApiRequestLocals } from "../../../types/api";

export async function updateUser(
  req: Request & ApiRequestLocals,
  res: Response
): Promise<Response> {
  // TODO: Implement user attribute update
  // Documentation: https://developer.okta.com/docs/reference/scim/scim-20/#update-the-user
  return res;
}
