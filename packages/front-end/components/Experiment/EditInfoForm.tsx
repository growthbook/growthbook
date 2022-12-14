import { FC } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ImplementationType,
} from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import MarkdownInput from "../Markdown/MarkdownInput";
import Modal from "../Modal";
import RadioSelector from "../Forms/RadioSelector";
import Field from "../Forms/Field";

const EditInfoForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const { visualEditorEnabled } = useOrgSettings();

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      name: experiment.name || "",
      implementation: experiment.implementation || "code",
      hypothesis: experiment.hypothesis || "",
      description: experiment.description || experiment.observations || "",
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
      {visualEditorEnabled && (
        <Field
          label="Type"
          render={() => (
            <RadioSelector
              value={form.watch("implementation")}
              setValue={(val: ImplementationType) =>
                form.setValue("implementation", val)
              }
              name="implementation"
              options={[
                {
                  key: "code",
                  display: "Code",
                  description:
                    "Using one of our SDKs (Javascript, React, PHP, Ruby, Go, Kotlin, or Python)",
                },
                {
                  key: "visual",
                  display: "Visual",
                  description: "Using our point & click Visual Editor",
                },
              ]}
            />
          )}
        />
      )}
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
