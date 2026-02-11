import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
} from "shared/types/experiment";
import { useForm } from "react-hook-form";
import { datetime } from "shared/dates";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import SelectField from "@/components/Forms/SelectField";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
  source?: string;
  holdout?: HoldoutInterfaceStringDates;
}

export default function EditStatusModal({
  experiment,
  close,
  mutate,
  source,
  holdout,
}: Props) {
  const isHoldout = experiment.type === "holdout";
  const experimentStatus = experiment.status;
  const form = useForm<{
    status: ExperimentStatus | "analysis";
    reason: string;
    dateEnded: string;
  }>({
    defaultValues: {
      status:
        isHoldout &&
        experimentStatus === "running" &&
        experiment.phases.length === 2
          ? "analysis"
          : experiment.status,
      reason: "",
      dateEnded: new Date().toISOString().substr(0, 16),
    },
  });
  const { apiCall } = useAuth();
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;
  const statusOptions = [
    {
      value: "draft",
      label: "Draft",
    },
    {
      value: "running",
      label: "Running",
    },
    ...(isHoldout
      ? [
          {
            value: "analysis",
            label: "Analysis Period",
          },
        ]
      : []),
    {
      value: "stopped",
      label: "Stopped",
    },
  ];
  return (
    <Modal
      trackingEventModalType="edit-status-modal"
      trackingEventModalSource={source}
      header={
        isHoldout ? "Force Holdout Status Change" : "Change Experiment Status"
      }
      bodyClassName="px-5"
      close={close}
      open={true}
      submit={form.handleSubmit(
        async (value: {
          status: ExperimentStatus | "analysis";
          reason: string;
          dateEnded: string;
          holdoutRunningStatus?: "running" | "analysis-period";
        }) => {
          const status = value.status;
          if (isHoldout && status === "analysis") {
            value.holdoutRunningStatus = "analysis-period";
            value.status = "running";
          } else if (isHoldout && status === "running") {
            value.holdoutRunningStatus = "running";
            value.status = "running";
          }
          if (holdout) {
            await apiCall(`/holdout/${holdout.id}/edit-status`, {
              method: "POST",
              body: JSON.stringify(value),
            });
            await apiCall(`/holdout/${holdout.id}/schedule`, {
              method: "DELETE",
            });
            mutate();
          } else {
            await apiCall(`/experiment/${experiment.id}/status`, {
              method: "POST",
              body: JSON.stringify(value),
            });
            mutate();
          }
        },
      )}
      cta="Update"
      submitColor="danger"
      useRadixButton={true}
    >
      {isHoldout && (
        <Box mb="5">
          <Text size="medium" color="text-mid">
            <strong>Warning: </strong>Changing the status of a Holdout will
            delete the existing schedule and could change the behavior of
            associated Feature Flags and Metrics.
          </Text>
        </Box>
      )}
      {hasLinkedChanges && (
        <Callout status="warning">
          Changes you make here will immediately affect any linked Feature Flags
          or Visual Changes.
        </Callout>
      )}
      <SelectField
        label="Status"
        options={statusOptions}
        onChange={(v) => {
          const status = v as ExperimentStatus | "analysis";
          form.setValue("status", status);
        }}
        value={form.watch("status")}
        sort={false}
      />
      {form.watch("status") === "stopped" &&
        experiment.status === "running" && (
          <>
            <Field
              label="Reason for stopping the test"
              textarea
              {...form.register("reason")}
              placeholder="(optional)"
            />
            <DatePicker
              label="Stop Time (UTC)"
              date={form.watch("dateEnded")}
              setDate={(v) => {
                form.setValue("dateEnded", v ? datetime(v) : "");
              }}
            />
          </>
        )}
    </Modal>
  );
}
