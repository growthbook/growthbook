import { Response, NextFunction } from "express";
import { getLicense } from "enterprise";
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

  // Check if license is expired (2 day buffer)
  if (license.exp) {
    let expiresWithBuffer = new Date(license.exp);
    expiresWithBuffer = new Date(
      expiresWithBuffer.setDate(expiresWithBuffer.getDate() + 2)
    );
    if (expiresWithBuffer < new Date()) {
      res.locals.licenseError = "License expired";
      res.setHeader("X-License-Error", "License expired");
    }
  }

  // Validate organization id with license
  if (req.headers["x-organization"] && license?.org) {
    if (req.headers["x-organization"] !== license.org) {
      res.locals.licenseError = "Organization id does not match license";
      res.setHeader(
        "X-License-Error",
        "Organization id does not match license"
      );
    }
  }

  next();
}
