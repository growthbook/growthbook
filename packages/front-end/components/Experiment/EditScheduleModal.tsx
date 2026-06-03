/**
 * EditScheduleModal
 *
 * Thin wrapper that fetches the live ramp schedule (if any) and renders
 * ExperimentRampScheduleModal.
 */
import { type ExperimentInterfaceStringDates } from "shared/types/experiment";
import { type RampScheduleInterface } from "shared/validators";
import useApi from "@/hooks/useApi";
import ExperimentRampScheduleModal from "@/components/Experiment/ExperimentRampScheduleModal";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}

export default function EditScheduleModal({ experiment, mutate, close }: Props) {
  const { data } = useApi<{ rampSchedule: RampScheduleInterface | null }>(
    experiment.rampScheduleId
      ? `/experiment/${experiment.id}/ramp-schedule`
      : "/noop",
  );

  const existingSchedule = data?.rampSchedule ?? null;

  return (
    <ExperimentRampScheduleModal
      experiment={experiment}
      existingSchedule={existingSchedule}
      close={close}
      mutate={mutate}
    />
  );
}
