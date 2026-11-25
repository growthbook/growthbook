import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useQaOverrideCount } from "@/hooks/useExperimentQaOverrides";
import ExposureLogsCard from "@/components/HealthTab/ExposureLogsCard";

export default function QaExposureLogs({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  if (!useQaOverrideCount(experiment)) return null;
  return (
    <ExposureLogsCard
      experiment={experiment}
      isTabActive={true}
      phase={experiment.phases.length - 1}
      exposureSource="qa"
      title="QA Exposure Logs"
    />
  );
}
