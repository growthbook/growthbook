import rateLimit from "express-rate-limit";
import { postFlagImportValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  createFlagImportFromFile,
} from "back-end/src/services/flagImports";

// Nobody has a key yet, so the address is the only handle. Per replica: the
// default MemoryStore isn't shared, and the cap on unclaimed uploads is the
// backstop. A file that fails its checks doesn't count against the sender.
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: (req) => req.ip ?? "",
  message: {
    message: "Too many uploads from this address. Try again later.",
  },
});

export const postFlagImport = createApiRequestHandler({
  ...postFlagImportValidator,
  middleware: [uploadRateLimit],
})(async (req) => {
  assertFlagImportsEnabled();
  return createFlagImportFromFile({
    file: req.body,
    name: req.query.name,
    agent: req.query.agent,
  });
});
