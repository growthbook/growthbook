import { HoldoutInterface } from "shared/validators";
import { useForm } from "react-hook-form";
import { Box, Text } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Modal from "../Modal";
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
  const permissionsUtils = usePermissionsUtil();
  const { apiCall } = useAuth();

  const form = useForm<Partial<HoldoutInterface>>({
    defaultValues: {
      scheduledStatusUpdates: holdout.scheduledStatusUpdates || {
        startAt: undefined,
        startAnalysisPeriodAt: undefined,
        stopAt: undefined,
      },
    },
  });

  const onSubmit = form.handleSubmit(async (rawValue) => {
    await apiCall<{
      holdout: HoldoutInterface;
    }>(`/holdout/${holdout.id}`, {
      method: "PUT",
      body: JSON.stringify({
        scheduledStatusUpdates: rawValue.scheduledStatusUpdates,
      }),
    });
    mutate();
  });

  const scheduledStatusUpdates = form.watch("scheduledStatusUpdates") || {};

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
        {/* {experiment.status === "running" && (
          <Callout status="warning" mb="4">
            <Text>
              Proceed with caution. Holdout is running. Adding or removing
              environments could impact results.{" "}
            </Text>
          </Callout>
        )} */}
        <ScheduleStatusChangeInputs
          defaultValue={scheduledStatusUpdates}
          onChange={(value) => {
            form.setValue("scheduledStatusUpdates", value);
          }}
        />
      </div>
    </Modal>
  );
};

export default EditScheduleModal;
