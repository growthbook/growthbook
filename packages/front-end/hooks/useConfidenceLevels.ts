import { getScopedSettings } from "shared/settings";
import { DEFAULT_CONFIDENCE_LEVEL } from "shared/constants";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function useConfidenceLevels(projectId: string | undefined) {
  const { organization } = useUser();
  const { getProjectById } = useDefinitions();
  const project =
    projectId && projectId.length > 0
      ? (getProjectById(projectId) ?? undefined)
      : undefined;
  const { settings } = getScopedSettings({ organization, project });
  const ciUpper = settings.confidenceLevel.value || DEFAULT_CONFIDENCE_LEVEL;
  return computeConfidenceLevelsFromCiUpper(ciUpper);
}

export function computeConfidenceLevelsFromCiUpper(ciUpper: number) {
  return {
    ciUpper,
    ciLower: 1 - ciUpper,
    ciUpperDisplay: Math.round(ciUpper * 100) + "%",
    ciLowerDisplay: Math.round((1 - ciUpper) * 100) + "%",
  };
}
