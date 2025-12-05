import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { datetime } from "shared/dates";
import { HoldoutInterface } from "back-end/src/validators/holdout";
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
  holdout?: HoldoutInterface;
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
      header={isHoldout ? "Change Holdout Status" : "Change Experiment Status"}
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
    >
      {hasLinkedChanges && (
        <div className="alert alert-danger">
          <strong>Warning:</strong> Changes you make here will immediately
          affect any linked Feature Flags or Visual Changes.
        </div>
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
