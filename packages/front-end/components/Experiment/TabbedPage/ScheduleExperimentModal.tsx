import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import Modal from "@/components/Modal";
import DatePicker from "@/components/DatePicker";
import { useAuth } from "@/services/auth";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";

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
  const variations = getLatestPhaseVariations(experiment);
  const initialDate = experiment.schedule?.date
    ? new Date(experiment.schedule.date)
    : new Date();
  const initialEndDate = experiment.schedule?.endDate
    ? new Date(experiment.schedule.endDate)
    : undefined;
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(initialDate);
  const [applySchedule, setApplySchedule] = useState(!!experiment.schedule?.date);
  const [endDate, setEndDate] = useState<Date | undefined>(initialEndDate);
  const [endAction, setEndAction] = useState<string>(() => {
    if (!experiment.schedule?.endDate) return "stop";
    if (
      experiment.schedule.endAction === "rollout" &&
      experiment.schedule.rolloutVariationId
    ) {
      return `rollout:${experiment.schedule.rolloutVariationId}`;
    }
    return "stop";
  });

  const endActionOptions = [
    {
      label: "Switch off experiment",
      value: "stop",
    },
    ...variations.map((variation) => ({
      label: `Roll out "${variation.name || variation.key}" to 100%`,
      value: `rollout:${variation.id}`,
    })),
  ];

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
                  ...(endDate
                    ? {
                        endDate: endDate.toISOString(),
                        ...(endAction.startsWith("rollout:")
                          ? {
                              endAction: "rollout",
                              rolloutVariationId:
                                endAction.split(":")[1] || undefined,
                            }
                          : { endAction: "stop" }),
                      }
                    : {}),
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
        <DatePicker
          date={endDate}
          setDate={(date) => {
            setEndDate(date);
            if (!date) {
              setEndAction("stop");
            }
          }}
          precision="datetime"
          label="End Date & Time (Optional)"
          disabled={!applySchedule}
          clearButton={true}
          containerClassName="form-group mt-3"
        />
        {applySchedule && endDate ? (
          <div className="mt-3">
            <SelectField
              label="At End Date"
              value={endAction}
              onChange={setEndAction}
              options={endActionOptions}
              sort={false}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
