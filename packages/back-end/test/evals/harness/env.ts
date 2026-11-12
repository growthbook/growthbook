import { existsSync, readFileSync } from "fs";
import path from "path";
import { parse } from "dotenv";
import {
  AI_PROVIDER_META,
  getProviderFromModel,
  type AIModel,
} from "shared/ai";

const ENV_LOCAL = path.resolve(__dirname, "../../../.env.local");

// Runs before any back-end module reads its environment. Only provider keys
// come from .env.local: the rest of a developer's file (license, Mongo URI,
// Slack apps) would point the eval at real services.
export function prepareEvalEnv(): void {
  const local = existsSync(ENV_LOCAL) ? parse(readFileSync(ENV_LOCAL)) : {};
  for (const { envVar, legacyEnvVars = [] } of Object.values(
    AI_PROVIDER_META,
  )) {
    for (const name of [envVar, ...legacyEnvVars]) {
      if (!process.env[name] && local[name]) process.env[name] = local[name];
    }
  }
  // Background jobs would race a trial's writes; the eval runs none.
  process.env.CRON_DISABLED = "true";
  // External agents call the eval server with one key per trial; the default
  // 60 a minute would throttle a busy agent and grade the limiter instead.
  process.env.API_RATE_LIMIT_MAX = "10000";
  // MCP calls carry telemetry headers; eval traffic stays out of GrowthBook's
  // own analytics.
  process.env.DISABLE_TELEMETRY = "true";
}

export function assertProviderKeys(models: AIModel[]): void {
  const missing = [
    ...new Set(
      models
        .map((m) => AI_PROVIDER_META[getProviderFromModel(m)].envVar)
        .filter((name) => !process.env[name]),
    ),
  ];
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(", ")}. Export it or add it to packages/back-end/.env.local.`,
    );
  }
}
