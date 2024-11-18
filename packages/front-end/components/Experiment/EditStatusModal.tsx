import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import SelectField from "@/components/Forms/SelectField";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

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
      header={"更改实验状态"}
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
          <strong>警告：</strong> 在此处所做的更改将立即影响任何关联的特性标志或可视化变更集。
        </div>
      )}
      <SelectField
        label="状态"
        options={[
          { label: "草稿", value: "draft" },
          { label: "运行中", value: "running" },
          { label: "已停止", value: "stopped" },
        ]}
        onChange={(v) => {
          const status = v as ExperimentStatus;
          form.setValue("status", status);
        }}
        value={form.watch("status")}
      />
      {form.watch("status") === "stopped" && experiment.status === "running" && (
        <>
          <Field
            label="停止测试的原因"
            textarea
            {...form.register("reason")}
            placeholder="(可选)"
          />
          <Field
            label="停止时间（UTC）"
            type="datetime-local"
            {...form.register("dateEnded")}
          />
        </>
      )}
    </Modal>
  );
}
