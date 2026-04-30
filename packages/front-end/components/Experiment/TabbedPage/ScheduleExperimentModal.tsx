import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Modal from "@/components/Modal";
import DatePicker from "@/components/DatePicker";
import { useAuth } from "@/services/auth";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";

type Props = {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
};

export default function ScheduleExperimentModal({
  experiment,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const initialDate = experiment.schedule?.date
    ? new Date(experiment.schedule.date)
    : new Date();
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(initialDate);
  const [applySchedule, setApplySchedule] = useState(!!experiment.schedule?.date);

  return (
    <Modal
      open={true}
      close={close}
      trackingEventModalType="experiment-schedule"
      trackingEventModalSource="experiment-more-menu"
      header="Schedule Experiment"
      submit={async () => {
        if (applySchedule && !scheduleDate) return;
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            schedule: applySchedule
              ? {
                  date: scheduleDate?.toISOString(),
                }
              : null,
            ...(applySchedule
              ? {}
              : experiment.status === "scheduled"
                ? { status: "draft" }
                : {}),
          }),
        });
        await mutate();
      }}
      cta="Done"
      useRadixButton={true}
    >
      <div className="p-2">
        <Checkbox
          label="Apply Schedule"
          value={applySchedule}
          setValue={setApplySchedule}
          weight="medium"
          mb="3"
          description={
            <Text color="text-low">
              Choose to start an experiment at a specified time.
            </Text>
          }
        />
        <DatePicker
          date={scheduleDate}
          setDate={setScheduleDate}
          precision="datetime"
          label="Start Date & Time"
          disabled={!applySchedule}
        />
      </div>
    </Modal>
  );
}
