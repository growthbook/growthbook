import { HoldoutInterfaceStringDates } from "shared/validators";
import { useForm } from "react-hook-form";
import { Box, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import ScheduleStatusChangeInputs from "./ScheduleStatusChangeInputs";

const validateSchedule = (
  startDate: string | undefined,
  startAnalysisPeriodDate: string | undefined,
  stopDate: string | undefined,
) => {
  // Check dependencies
  if (stopDate && (!startDate || !startAnalysisPeriodDate)) {
    return "To set a stop date, you must also set a start date and an analysis start date";
  }

  if (startAnalysisPeriodDate && !startDate) {
    return "To set an analysis start date, you must first set a start date";
  }

  return "";
};

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
  const [errors, setErrors] = useState<string>("");

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
    setErrors("");
    const validationError = validateSchedule(
      rawValue.scheduledStatusUpdates?.startAt || experiment.status !== "draft"
        ? experiment.phases[0].dateStarted
        : undefined,
      rawValue.scheduledStatusUpdates?.startAnalysisPeriodAt ||
        holdout.analysisStartDate,
      rawValue.scheduledStatusUpdates?.stopAt,
    );
    if (validationError) {
      setErrors(validationError);
      return;
    }
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
      trackingEventModalType=""
      header="Edit Holdout Schedule"
      close={close}
      submit={onSubmit}
      size="lg"
      error={errors}
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
