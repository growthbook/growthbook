import rateLimit from "express-rate-limit";
import { getFlagImportValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  getFlagImportByToken,
} from "back-end/src/services/flagImports";

// Room for the claim page and an agent polling, per address and per replica.
const statusRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "",
  message: { message: "Too many requests. Try again in a minute." },
});

export const getFlagImport = createApiRequestHandler({
  ...getFlagImportValidator,
  middleware: [statusRateLimit],
})(async (req) => {
  assertFlagImportsEnabled();
  return { flagImport: await getFlagImportByToken(req.params.token) };
});
