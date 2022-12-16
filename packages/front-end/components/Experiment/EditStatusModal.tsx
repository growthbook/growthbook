import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}

export default function EditStatusModal({ experiment, close, mutate }: Props) {
  const form = useForm({
    defaultValues: {
      status: experiment.status,
      reason: "",
      dateEnded: new Date().toISOString().substr(0, 16),
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
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
      <Field
        label="Status"
        options={["draft", "running", "stopped"]}
        {...form.register("status")}
      />
      {form.watch("status") === "stopped" && experiment.status === "running" && (
        <>
          <Field
            label="Reason for stopping the test"
            textarea
            {...form.register("reason")}
            placeholder="(optional)"
          />
          <Field
            label="Stop Time (UTC)"
            type="datetime-local"
            {...form.register("dateEnded")}
          />
        </>
      )}
    </Modal>
  );
}
