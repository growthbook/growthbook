import { ArchetypeInterface } from "shared/types/archetype";
import { FeatureInterface, FeatureTestResult } from "shared/types/feature";
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
    }&project=${project ?? ""}`,
  );

export const parseFeatureResult = (
  tr: FeatureTestResult,
): {
  matchedRule: string;
  matchedRuleName: string;
  brief: string;
  debugLog: string[];
} => {
  let matchedRule;
  const debugLog: string[] = [];
  if (tr?.result?.ruleId && tr?.featureDefinition?.rules) {
    matchedRule = tr.featureDefinition.rules.find(
      (r) => r.id === tr?.result?.ruleId,
    );
  }
  let matchedRuleName = "";
  let brief = "";
  if (tr?.result?.source === "experiment") {
    const expName =
      tr.result?.experimentResult?.name || tr?.result?.experiment?.key || null;
    matchedRuleName = "Experiment" + (expName ? " (" + expName + ")" : "");
    brief = "In experiment";
  } else if (tr?.result?.source === "force") {
    matchedRuleName = "Forced";
    brief = "Force";
    if (matchedRule && matchedRule?.coverage) {
      matchedRuleName = "Rollout (" + matchedRule?.coverage * 100 + "%)";
      brief = "Rollout";
    }
  } else if (tr?.result?.source === "defaultValue") {
    matchedRuleName = "None - Returned Default Value";
    brief = "Default";
  }
  if (tr?.log) {
    tr.log.forEach((log) => {
      const reason = log[0];
      if (reason === "Skip rule because of condition") {
        debugLog.push(`Skipped because user did not match the rule conditions`);
      } else if (reason === "Skip rule because user not included in rollout") {
        debugLog.push(
          `Skipped rule because the user is not included in rollout`,
        );
      } else if (reason === "In experiment") {
        debugLog.push(`Included user in experiment rule`);
      } else if (reason === "Use default value") {
        debugLog.push(
          `No rules matched, using default value (${JSON.stringify(
            tr?.defaultValue,
          )})`,
        );
      } else {
        debugLog.push(`${log[0]}`);
      }
    });
  }
  return { matchedRule, matchedRuleName, brief, debugLog };
};
