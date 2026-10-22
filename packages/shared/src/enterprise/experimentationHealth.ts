// Import the specific validator files, NOT the shared/validators barrel (see
// experimentQualityScore.ts for the module-initialization cycle it causes).
import { ExperimentationHealthSettingsInterface } from "../validators/experimentation-health";
import { ExperimentQualityConfigBody } from "../validators/experiment-quality-score";
import {
  ResolvedExperimentQualityScoreSettings,
  resolveExperimentQualityScoreSettings,
} from "./experimentQualityScore";

// Inheritance: a Project record's fields win; everything else comes from the
// organization default's record, then the built-in defaults
type HealthRecord = Partial<
  Pick<ExperimentationHealthSettingsInterface, "quality">
>;

export interface ResolvedQualityScope {
  enabled: boolean;
  // undefined = the built-in default checks
  config?: ExperimentQualityConfigBody;
  // Which fields the Project record sets itself rather than inheriting
  overridden: { enabled: boolean; config: boolean };
}

// Quality scoring is off unless the org or Project record turns it on
export function resolveQualityScope(
  orgRecord?: HealthRecord | null,
  projectRecord?: HealthRecord | null,
): ResolvedQualityScope {
  const org = orgRecord?.quality;
  const project = projectRecord?.quality;
  return {
    enabled: project?.enabled ?? org?.enabled ?? false,
    config: project?.config ?? org?.config,
    overridden: {
      enabled: project?.enabled !== undefined,
      config: project?.config !== undefined,
    },
  };
}

/**
 * The settings that score an experiment, or null when quality scoring is
 * off for its scope. With org AI off, AI checks are dropped so their share
 * goes to the other checks instead of staying pending.
 */
export function resolveExperimentQualitySettings({
  orgRecord,
  projectRecord,
  aiEnabled,
}: {
  orgRecord?: HealthRecord | null;
  projectRecord?: HealthRecord | null;
  aiEnabled: boolean;
}): ResolvedExperimentQualityScoreSettings | null {
  const { enabled, config } = resolveQualityScope(orgRecord, projectRecord);
  if (!enabled) return null;
  return resolveExperimentQualityScoreSettings(
    aiEnabled ? config : { ...config, aiChecksEnabled: false },
  );
}

// How many settings a record customizes (for "N settings customized")
export function countHealthOverrides(record?: HealthRecord | null): number {
  if (!record) return 0;
  const { enabled, config } = record.quality ?? {};
  return [enabled, config].filter((v) => v !== undefined).length;
}
