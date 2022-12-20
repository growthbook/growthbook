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
  if (req.headers["x-organization"] && license?.org) {
    if (req.headers["x-organization"] !== license.org) {
      return res.status(402).json({
        code: 402,
        message: "Organization id does not match license",
      });
    }
  }

  next();
}
