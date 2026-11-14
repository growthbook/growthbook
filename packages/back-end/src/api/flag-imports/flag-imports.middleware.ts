import { Request, RequestHandler } from "express";
import { isFlagImportsEnabled } from "back-end/src/services/flagImports";
import { flagImportSourceKey } from "back-end/src/util/flagImports.util";

// First on every flag-import route, so a deployment with the feature off reads
// and checks nothing. Answers as an unknown path does.
export const requireFlagImports: RequestHandler = (req, res, next) => {
  if (isFlagImportsEnabled()) return next();
  res.status(404).json({ message: "Unknown API endpoint" });
};

export const sourceKey = (req: Request): string => flagImportSourceKey(req.ip);
