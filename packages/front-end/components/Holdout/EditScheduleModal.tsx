import { HoldoutInterfaceStringDates } from "shared/validators";
import { useForm } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Text from "@/ui/Text";
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
          ...(experiment.status === "draft" && {
            startAt: rawValue.scheduledStatusUpdates.startAt
              ? new Date(rawValue.scheduledStatusUpdates.startAt).toISOString()
              : "",
          }),
          ...(!holdout.analysisStartDate && {
            startAnalysisPeriodAt: rawValue.scheduledStatusUpdates
              .startAnalysisPeriodAt
              ? new Date(
                  rawValue.scheduledStatusUpdates.startAnalysisPeriodAt,
                ).toISOString()
              : "",
          }),
          ...(experiment.status !== "stopped" && {
            stopAt: rawValue.scheduledStatusUpdates.stopAt
              ? new Date(rawValue.scheduledStatusUpdates.stopAt).toISOString()
              : "",
          }),
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
          <Text color="text-mid">
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
