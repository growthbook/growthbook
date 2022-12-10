import { Request, Response, NextFunction } from "express";
import { getLicense } from "../../init/license";
import { IS_CLOUD } from "../../util/secrets";

export default function verifyLicenseMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (IS_CLOUD) {
    return next();
  }

  const license = getLicense();
  if (!license) {
    return next();
  }

  // Validate organization id with license
  if (req.headers["x-organization-id"] && license?.org) {
    if (req.headers["x-organization-id"] !== license.org) {
      const e = new Error("Organization id does not match license");
      next(e);
    }
  }

  next();
}
