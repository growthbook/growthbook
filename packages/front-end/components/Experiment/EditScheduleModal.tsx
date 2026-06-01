import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box } from "@radix-ui/themes";
import { format as formatTimeZone } from "date-fns-tz";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import DatePicker from "@/components/DatePicker";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";
import Helpertext from "@/ui/HelperText";
import Button from "@/ui/Button";

export default function EditScheduleModal({
  experiment,
  mutate,
  close,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}) {
  const form = useForm({
    defaultValues: {
      statusUpdateSchedule: {
        startAt: experiment.statusUpdateSchedule?.startAt,
      },
    },
  });

  const { apiCall } = useAuth();

  const now = new Date();
  const hasSchedule = !!experiment.statusUpdateSchedule?.startAt;
  const isApproved = !!experiment.nextScheduledStatusUpdate;
  const scheduleIsInThePast =
    experiment.statusUpdateSchedule?.startAt &&
    new Date(experiment.statusUpdateSchedule.startAt) < now;

  return (
    <ModalStandard
      trackingEventModalType="edit-schedule-modal"
      trackingEventModalSource="eid"
      open={true}
      close={close}
      header={hasSchedule ? "Edit Schedule" : "Add Schedule"}
      subheader="Choose to start an experiment at a specified time. Once the selected time arrives and schedule is approved, linked changes will be activated and users will begin to see your experiment variations immediately. "
      cta={hasSchedule ? "Update" : "Done"}
      ctaColor="violet"
      ctaEnabled={
        !hasSchedule && !form.watch("statusUpdateSchedule.startAt")
          ? false
          : true
      }
      size="lg"
      secondaryAction={
        isApproved ? (
          <Button
            variant="ghost"
            color="red"
            onClick={async () => {
              await apiCall(`/experiment/${experiment.id}/unschedule-start`, {
                method: "POST",
              });
              mutate();
              close();
            }}
          >
            Unschedule Experiment
          </Button>
        ) : undefined
      }
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            statusUpdateSchedule: {
              startAt: data.statusUpdateSchedule.startAt,
            },
          }),
        });
        mutate();
      })}
    >
      <Box>
        <Text as="label" color="text-high" mb={hasSchedule ? "1" : "2"}>
          Start Date & Time{" "}
          <Text as="span" color="text-mid">
            ({formatTimeZone(new Date(), "z")})
          </Text>
        </Text>
        {hasSchedule && (
          <Text as="div" color="text-mid" mb="2">
            Leave empty to remove schedule.
          </Text>
        )}
        <DatePicker
          containerClassName=""
          clearButton
          label=""
          date={form.watch("statusUpdateSchedule.startAt")}
          disableBefore={now}
          setDate={(v) => {
            form.setValue(
              "statusUpdateSchedule.startAt",
              v ? v.toISOString() : "",
            );
          }}
        />
        {scheduleIsInThePast && (
          <Helpertext mt="2" status="warning">
            Scheduled time has passed
          </Helpertext>
        )}
      </Box>
    </ModalStandard>
  );
}
