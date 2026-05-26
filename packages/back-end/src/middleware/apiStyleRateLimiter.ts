import { Request } from "express";
import rateLimit from "express-rate-limit";
import { parseEnvInt } from "shared/util";
import { IS_CLOUD } from "back-end/src/util/secrets";

const API_RATE_LIMIT_MAX = parseEnvInt(process.env.API_RATE_LIMIT_MAX, 60, {
  min: 1,
  name: "API_RATE_LIMIT_MAX",
});

const messageRateLimit = IS_CLOUD ? 60 : API_RATE_LIMIT_MAX;

/**
 * Since API_RATE_LIMIT_MAX is per server, the error message is not quite accurate.
 * For cloud we hardcode the approximate limit. As many self hosted users have a single server,
 * the actual limit is probably API_RATE_LIMIT_MAX.
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
      message: `Too many requests, limit to ${messageRateLimit} per minute`,
    },
  });
}
