import { HoldoutInterface } from "shared/validators";
import { useForm } from "react-hook-form";
import { Box, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getValidDate } from "shared/dates";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import ScheduleStatusChangeInputs from "./ScheduleStatusChangeInputs";

const EditScheduleModal = ({
  holdout,
  experiment,
  close,
  mutate,
}: {
  holdout: HoldoutInterface;
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
}) => {
  const { apiCall } = useAuth();

  const form = useForm<Pick<HoldoutInterface, "scheduledStatusUpdates">>({
    defaultValues: {
      scheduledStatusUpdates: {
        startAt: holdout.scheduledStatusUpdates?.startAt
          ? getValidDate(holdout.scheduledStatusUpdates.startAt)
          : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        startAnalysisPeriodAt: holdout.scheduledStatusUpdates
          ?.startAnalysisPeriodAt
          ? getValidDate(holdout.scheduledStatusUpdates.startAnalysisPeriodAt)
          : new Date(Date.now() + 65 * 24 * 60 * 60 * 1000),
        stopAt: holdout.scheduledStatusUpdates?.stopAt
          ? getValidDate(holdout.scheduledStatusUpdates.stopAt)
          : new Date(Date.now() + 95 * 24 * 60 * 60 * 1000),
      },
    },
  });

  const onSubmit = form.handleSubmit(async (rawValue) => {
    // Convert Date objects to ISO strings for API
    const scheduledStatusUpdates = rawValue.scheduledStatusUpdates
      ? {
          startAt: rawValue.scheduledStatusUpdates.startAt
            ? new Date(rawValue.scheduledStatusUpdates.startAt).toISOString()
            : undefined,
          startAnalysisPeriodAt: rawValue.scheduledStatusUpdates
            .startAnalysisPeriodAt
            ? new Date(
                rawValue.scheduledStatusUpdates.startAnalysisPeriodAt,
              ).toISOString()
            : undefined,
          stopAt: rawValue.scheduledStatusUpdates.stopAt
            ? new Date(rawValue.scheduledStatusUpdates.stopAt).toISOString()
            : undefined,
        }
      : undefined;

    await apiCall<{
      holdout: HoldoutInterface;
    }>(`/holdout/${holdout.id}`, {
      method: "PUT",
      body: JSON.stringify({
        scheduledStatusUpdates,
      }),
    });
    mutate();
  });

  return (
    <Modal
      open={true}
      trackingEventModalType=""
      header="Edit Schedule"
      close={close}
      submit={onSubmit}
      size="lg"
    >
      <div className="px-2">
        <Box mb="4">
          <Text size="2" style={{ color: "var(--color-text-mid)" }}>
            Schedule the start, analysis period start, and stop of the holdout.
          </Text>
        </Box>
        {!holdout.scheduledStatusUpdates && (
          <Callout status="info" mb="4">
            This holdout currently has no schedule set. Fields have been
            pre-filled with some default values.
          </Callout>
        )}
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
