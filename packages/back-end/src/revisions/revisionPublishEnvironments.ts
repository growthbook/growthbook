import { ConfigInterface } from "shared/types/config";
import {
  configPublishEnvironments as configPublishEnvs,
  constantPublishEnvironments as constantPublishEnvs,
} from "shared/util";
import { serveFootprint } from "shared/permissions";
import type { PublishFootprint } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { getEnvironments } from "back-end/src/services/organizations";

export function configPublishEnvironments(
  _context: Context,
  config: Pick<ConfigInterface, "scopedConfig">,
): string[] {
  return configPublishEnvs(config);
}

export function constantPublishEnvironments(
  _context?: Context,
  changedEnvironments?: string[],
): string[] {
  return constantPublishEnvs(changedEnvironments);
}

export type { PublishFootprint } from "shared/enterprise";

/** Resolves the environments used for publish authorization. */
export function resolvePublishFootprint(
  context: Context,
  footprint: PublishFootprint | undefined,
  entity: {
    project?: string;
    targetingProjects?: string[];
    targetingAllProjects?: boolean;
  },
): string[] {
  if (!footprint || footprint.scope === "unscoped") return [];
  if (footprint.scope === "everywhere") {
    return serveFootprint(getEnvironments(context.org), entity);
  }
  // Treat named-but-empty scope as everywhere served, never as a skipped check.
  return footprint.environments.length
    ? footprint.environments
    : serveFootprint(getEnvironments(context.org), entity);
}

/** Uses explicit scope when present; otherwise archive changes reach everywhere served. */
export function archiveServeFootprint(
  context: Context,
  entity: {
    project?: string;
    targetingProjects?: string[];
    targetingAllProjects?: boolean;
  },
  scoped: string[] = [],
): string[] {
  if (scoped.length) return scoped;
  return serveFootprint(getEnvironments(context.org), entity);
}
