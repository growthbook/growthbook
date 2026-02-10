import { HoldoutInterfaceStringDates } from "shared/validators";
import { useForm } from "react-hook-form";
import { Box, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import ScheduleStatusChangeInputs from "./ScheduleStatusChangeInputs";

const EditScheduleModal = ({
  holdout,
  experiment,
  close,
  mutate,
}: {
  holdout: HoldoutInterfaceStringDates;
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
}) => {
  const { apiCall } = useAuth();

  const form = useForm<
    Pick<HoldoutInterfaceStringDates, "scheduledStatusUpdates">
  >({
    defaultValues: {
      scheduledStatusUpdates: {
        startAt: holdout.scheduledStatusUpdates?.startAt,
        startAnalysisPeriodAt:
          holdout.scheduledStatusUpdates?.startAnalysisPeriodAt,
        stopAt: holdout.scheduledStatusUpdates?.stopAt,
      },
    },
  });

  const onSubmit = form.handleSubmit(async (rawValue) => {
    // Convert Date objects to ISO strings for API
    const scheduledStatusUpdates = rawValue.scheduledStatusUpdates
      ? {
          startAt:
            rawValue.scheduledStatusUpdates.startAt &&
            experiment.status !== "running"
              ? new Date(rawValue.scheduledStatusUpdates.startAt).toISOString()
              : holdout.scheduledStatusUpdates?.startAt,
          startAnalysisPeriodAt:
            rawValue.scheduledStatusUpdates.startAnalysisPeriodAt &&
            !(experiment.status === "running" && holdout.analysisStartDate)
              ? new Date(
                  rawValue.scheduledStatusUpdates.startAnalysisPeriodAt,
                ).toISOString()
              : holdout.scheduledStatusUpdates?.startAnalysisPeriodAt,
          stopAt:
            rawValue.scheduledStatusUpdates.stopAt &&
            experiment.status !== "stopped"
              ? new Date(rawValue.scheduledStatusUpdates.stopAt).toISOString()
              : holdout.scheduledStatusUpdates?.stopAt,
        }
      : undefined;

    await apiCall<{
      holdout: HoldoutInterfaceStringDates;
    }>(`/holdout/${holdout.id}`, {
      method: "PUT",
      body: JSON.stringify({
        scheduledStatusUpdates,
      }),
    });
    mutate();
    close();
  });

  return (
    <Modal
      open={true}
      ctaEnabled={experiment.status !== "stopped" && !experiment.archived}
      trackingEventModalType=""
      header="Edit Holdout Schedule"
      close={close}
      submit={onSubmit}
      size="lg"
      autoCloseOnSubmit={false}
    >
      <div className="px-2">
        <Box mb="4">
          <Text size="2" style={{ color: "var(--color-text-mid)" }}>
            Schedule the Holdout to start, transition to analysis, and end
            analysis.
          </Text>
        </Box>
        <ScheduleStatusChangeInputs
          form={form}
          holdout={holdout}
          experiment={experiment}
        />
      </div>
    </Modal>
  );
};

export default EditScheduleModal;
