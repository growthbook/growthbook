import { Response, NextFunction } from "express";
import { getLicense, licenseIsExpired } from "enterprise";
import { IS_CLOUD } from "../../util/secrets";
import { AuthRequest } from "../../types/AuthRequest";

export default function verifyLicenseMiddleware(
  req: AuthRequest,
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
  if (licenseIsExpired()) {
    res.locals.licenseError = "License expired";
    res.setHeader("X-License-Error", "License expired");
  }

  // Validate organization id with license
  if (req.headers["x-organization"] && license?.organizationId) {
    if (req.headers["x-organization"] !== license.organizationId) {
      res.locals.licenseError = "Organization id does not match license";
      res.setHeader(
        "X-License-Error",
        "Organization id does not match license"
      );
    }
  }

  next();
}
