import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import MarkdownInput from "../Markdown/MarkdownInput";
import Modal from "../Modal";
import Field from "../Forms/Field";

const EditInfoForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      name: experiment.name || "",
      implementation: experiment.implementation || "code",
      hypothesis: experiment.hypothesis || "",
      description: experiment.description || "",
      visualEditorUrl: experiment.visualEditorUrl || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header={"Edit Info"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const data = { ...value };

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      })}
      cta="Save"
    >
      <Field label="Name" {...form.register("name")} />
      <Field
        required
        label="Visual Editor Target URL"
        {...form.register("visualEditorUrl")}
      />
      <Field
        label="Description"
        render={(id) => (
          <MarkdownInput
            value={form.watch("description")}
            setValue={(val) => form.setValue("description", val)}
            id={id}
            placeholder="Background info, what's changing, etc."
          />
        )}
      />
      <Field
        label="Hypothesis"
        {...form.register("hypothesis")}
        placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
        textarea
      />
    </Modal>
  );
};

export default EditInfoForm;
