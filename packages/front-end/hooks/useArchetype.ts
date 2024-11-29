import { ArchetypeInterface } from "back-end/types/archetype";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import useApi from "./useApi";

export const useArchetype = ({
  feature,
  version,
  project,
  skipRulesWithPrerequisites = false,
}: {
  feature: FeatureInterface;
  version: number;
  project?: string;
  skipRulesWithPrerequisites?: boolean;
}) =>
  useApi<{
    status: number;
    archetype: ArchetypeInterface[];
    featureResults: Record<string, FeatureTestResult[]>;
  }>(
    `/archetype/eval/${feature.id}/${version}?skipRulesWithPrerequisites=${
      skipRulesWithPrerequisites ? 1 : 0
    }&project=${project ?? ""}`
  );
