import type { Response } from "express";
import { PageLoadReport, pageLoadValidator } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";

export const postPageLoad = async (
  req: AuthRequest<PageLoadReport>,
  res: Response<{ status: 200 }>,
) => {
  const pageLoad = pageLoadValidator.parse(req.body);
  req.log.info({ pageLoad }, "browser page load");
  res.status(200).json({ status: 200 });
};
