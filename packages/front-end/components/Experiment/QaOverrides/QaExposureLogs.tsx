import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import ExposureLogsCard from "@/components/HealthTab/ExposureLogsCard";

/**
 * Exposures recorded under the draft's QA tracking key, below the
 * Implementation panel. Shown only once there is an override to produce them.
 */
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
