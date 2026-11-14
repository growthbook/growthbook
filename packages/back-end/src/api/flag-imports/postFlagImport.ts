import { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  findFlagsJsonProblems,
  postFlagImportValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  createFlagImportFromFile,
} from "back-end/src/services/flagImports";
import { requireFlagImports, sourceKey } from "./flag-imports.middleware";

const HOUR = 60 * 60 * 1000;
const tooMany = {
  message: "Too many uploads from this address. Try again later.",
};

// Nobody has a key yet, so the sender's address is the only handle. Per
// replica: the default MemoryStore isn't shared, and the cap on unclaimed
// uploads is the backstop. A file that fails its checks doesn't use up the
// sender's uploads, but every request counts as an attempt.
const attemptRateLimit = rateLimit({
  windowMs: HOUR,
  max: 60,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: sourceKey,
  message: tooMany,
});
const uploadRateLimit = rateLimit({
  windowMs: HOUR,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: sourceKey,
  message: tooMany,
});

// The app's body parser has already held the file to its size limit (see
// app.ts). This stops at the first few problems, where the handler's own check
// would work through every one a file could be built to have.
const checkFile: RequestHandler = (req, res, next) => {
  const problems = findFlagsJsonProblems(req.body);
  if (!problems.length) return next();
  res.status(400).json({ message: `Request body: ${problems.join(", ")}` });
};

export const postFlagImport = createApiRequestHandler({
  ...postFlagImportValidator,
  middleware: [
    requireFlagImports,
    attemptRateLimit,
    uploadRateLimit,
    checkFile,
  ],
})(async (req) => {
  assertFlagImportsEnabled();
  return createFlagImportFromFile({
    file: req.body,
    name: req.query.name,
    agent: req.query.agent,
  });
});
