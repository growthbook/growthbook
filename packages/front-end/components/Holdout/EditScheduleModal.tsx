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
    Pick<HoldoutInterfaceStringDates, "statusUpdateSchedule">
  >({
    defaultValues: {
      statusUpdateSchedule: {
        startAt: holdout.statusUpdateSchedule?.startAt,
        startAnalysisPeriodAt:
          holdout.statusUpdateSchedule?.startAnalysisPeriodAt,
        stopAt: holdout.statusUpdateSchedule?.stopAt,
      },
    },
  });

  const onSubmit = form.handleSubmit(async (rawValue) => {
    // Convert Date objects to ISO strings for API
    const statusUpdateSchedule = rawValue.statusUpdateSchedule
      ? {
          ...(experiment.status === "draft" && {
            startAt: rawValue.statusUpdateSchedule.startAt
              ? new Date(rawValue.statusUpdateSchedule.startAt).toISOString()
              : "",
          }),
          ...(!holdout.analysisStartDate && {
            startAnalysisPeriodAt: rawValue.statusUpdateSchedule
              .startAnalysisPeriodAt
              ? new Date(
                  rawValue.statusUpdateSchedule.startAnalysisPeriodAt,
                ).toISOString()
              : "",
          }),
          ...(experiment.status !== "stopped" && {
            stopAt: rawValue.statusUpdateSchedule.stopAt
              ? new Date(rawValue.statusUpdateSchedule.stopAt).toISOString()
              : "",
          }),
        }
      : undefined;

    await apiCall<{
      holdout: HoldoutInterfaceStringDates;
    }>(`/holdout/${holdout.id}`, {
      method: "PUT",
      body: JSON.stringify({
        statusUpdateSchedule,
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
