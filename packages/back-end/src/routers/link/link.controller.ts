import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getSandboxLinkInfo,
  linkSandboxAsNewWorkspace,
  SandboxLinkInfo,
} from "back-end/src/services/agentSignup";

// Runs with the person signed in and no workspace chosen: the code, not a
// membership, says which sandbox this is about.
export async function getLinkInfo(
  req: AuthRequest<null, null, { code: string }>,
  res: Response<{ status: 200; link: SandboxLinkInfo }>,
) {
  const link = await getSandboxLinkInfo(req.query.code);
  res.status(200).json({ status: 200, link });
}

export async function postLinkAccept(
  req: AuthRequest<{ code: string }>,
  res: Response<{ status: 200; organizationId: string; runUrl: string }>,
) {
  if (!req.userId || !req.email) {
    throw new Error("Must be signed in to link a setup.");
  }
  const { organization, runUrl } = await linkSandboxAsNewWorkspace({
    rawCode: req.body.code,
    user: { id: req.userId, email: req.email },
  });
  res
    .status(200)
    .json({ status: 200, organizationId: organization.id, runUrl });
}
