import { ExperimentPhaseStringDates } from "shared/types/experiment";
import {
  hasAttributeCondition,
  hasTargetingConfigured,
} from "shared/experiments";
import ConditionDisplay from "@/components/Features/ConditionDisplay";

export default function QaOverrideExperimentTargeting({
  phase,
}: {
  phase?: Pick<
    ExperimentPhaseStringDates,
    "condition" | "savedGroups" | "prerequisites"
  >;
}) {
  if (!phase || !hasTargetingConfigured(phase)) return <>Everyone</>;
  return (
    <ConditionDisplay
      condition={
        hasAttributeCondition(phase.condition) ? phase.condition : undefined
      }
      savedGroups={phase.savedGroups?.length ? phase.savedGroups : undefined}
      prerequisites={
        phase.prerequisites?.length ? phase.prerequisites : undefined
      }
    />
  );
}
