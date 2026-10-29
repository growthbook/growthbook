import type { EvalConfig } from "back-end/test/evals/harness/config";
import { skillsSource } from "back-end/test/evals/harness/metadata";
import type { DriverFactory } from "./driver";
import { EXTERNAL_PROFILES, type ExternalProfile } from "./external/adapter";
import { claudeCodeHarness } from "./external/claude-code";
import { externalDriver } from "./external";
import { IN_APP_PROFILES, inAppDriver, type InAppProfile } from "./in-app";

function oneOf<T extends string>(
  what: string,
  value: string,
  allowed: readonly T[],
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `Unknown ${what} "${value}". Use one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
}

export function createDriverFactory(config: EvalConfig): DriverFactory {
  switch (config.driver) {
    case "in-app":
      return inAppDriver(
        oneOf<InAppProfile>(
          "in-app profile",
          config.profile ?? "skills",
          IN_APP_PROFILES,
        ),
        config.agentModel,
      );
    case "claude-code":
      return externalDriver(
        claudeCodeHarness(
          oneOf<ExternalProfile>(
            "claude-code profile",
            config.profile ?? "mcp",
            EXTERNAL_PROFILES,
          ),
          {
            model: config.agentModelFlag,
            skillsSource: skillsSource(config.skillsSrc),
            mcpServer: config.mcpServer,
          },
        ),
      );
    default:
      throw new Error(
        `Unknown driver "${config.driver}". Use: in-app, claude-code`,
      );
  }
}
