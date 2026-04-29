import { Request } from "express";
import rateLimit from "express-rate-limit";
import { parseEnvInt } from "shared/util";
import { IS_CLOUD } from "back-end/src/util/secrets";

const API_RATE_LIMIT_MAX = parseEnvInt(process.env.API_RATE_LIMIT_MAX, 60, {
  min: 1,
  name: "API_RATE_LIMIT_MAX",
});

const overallRateLimit = IS_CLOUD ? 60 : API_RATE_LIMIT_MAX;

/**
 * Same window and cap as `/api/v1` (see `API_RATE_LIMIT_MAX`). Use after auth
 * with a keyGenerator that identifies the caller (e.g. secret API key id).
 */
export function apiStyleRateLimiter(
  keyGenerator: (req: Request) => string,
): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 60 * 1000,
    max: API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: {
      message: `Too many requests, limit to ${overallRateLimit} per minute`,
    },
  });
}
