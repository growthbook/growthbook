import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import SelectField from "@/components/Forms/SelectField";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
  source?: string;
}

export default function EditStatusModal({
  experiment,
  close,
  mutate,
  source,
}: Props) {
  const form = useForm({
    defaultValues: {
      status: experiment.status,
      reason: "",
      dateEnded: new Date().toISOString().substr(0, 16),
    },
  });
  const { apiCall } = useAuth();

  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  return (
    <Modal
      trackingEventModalType="edit-status-modal"
      trackingEventModalSource={source}
      header={"Change Experiment Status"}
      close={close}
      open={true}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}/status`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
    >
      {hasLinkedChanges && (
        <div className="alert alert-danger">
          <strong>Warning:</strong> Changes you make here will immediately
          affect any linked Feature Flags or Visual Changes.
        </div>
      )}
      <SelectField
        label="Status"
        options={[
          { label: "draft", value: "draft" },
          { label: "running", value: "running" },
          { label: "stopped", value: "stopped" },
        ]}
        onChange={(v) => {
          const status = v as ExperimentStatus;
          form.setValue("status", status);
        }}
        value={form.watch("status")}
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
