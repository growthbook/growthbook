import { useMemo } from "react";
import { getScopedSettings } from "shared/settings";
import {
  DEFAULT_CONFIDENCE_LEVEL,
  DEFAULT_P_VALUE_THRESHOLD,
} from "shared/constants";
import { ProjectInterface } from "shared/types/project";
import { SignificanceThresholds } from "shared/types/stats";
import { OrganizationInterface } from "shared/types/organization";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { computeConfidenceLevelsFromCiUpper } from "./useConfidenceLevels";

/**
 * Returns a Map of project-scoped significance thresholds (Bayesian
 * confidence levels + frequentist p-value threshold) for every project in the
 * current org, plus an entry keyed by the empty string (`""`) that holds the
 * org-level defaults.
 *
 * Use this in components that render results for many experiments at once
 * (potentially across projects), where calling `useConfidenceLevels` /
 * `usePValueThreshold` in a loop would violate the rules of hooks. Callers
 * should look up by `experiment.project || ""` and fall back to the `""`
 * entry for unknown project ids.
 */
export default function useSignificanceThresholdsByProject(): Map<
  string,
  SignificanceThresholds
> {
  const { organization } = useUser();
  const { projects } = useDefinitions();

  return useMemo(() => {
    const map = new Map<string, SignificanceThresholds>();
    map.set("", computeThresholds(organization, undefined));
    for (const project of projects) {
      map.set(project.id, computeThresholds(organization, project));
    }
    return map;
  }, [organization, projects]);
}

function computeThresholds(
  organization: Partial<OrganizationInterface>,
  project: ProjectInterface | undefined,
): SignificanceThresholds {
  const { settings } = getScopedSettings({ organization, project });
  const ciUpper = settings.confidenceLevel.value || DEFAULT_CONFIDENCE_LEVEL;
  return {
    bayesianConfidenceLevels: computeConfidenceLevelsFromCiUpper(ciUpper),
    pValueThreshold:
      settings.pValueThreshold.value || DEFAULT_P_VALUE_THRESHOLD,
  };
}
