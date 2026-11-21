import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import ExposureLogsCard from "@/components/HealthTab/ExposureLogsCard";

export default function QaExposureLogs({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const { data } = useExperimentQaOverrides(experiment.id);
  if (!data?.overrides.length) return null;
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
