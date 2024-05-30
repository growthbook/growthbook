import { FC, ReactElement } from "react";
import { useForm } from "react-hook-form";
import { ProjectInterface } from "@back-end/types/project";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";

const EditProjectForm: FC<{
  apiEndpoint: string;
  projectOptions: ProjectInterface[];
  current?: string;
  additionalMessage?: string | ReactElement | null;
  ctaEnabled?: boolean;
  cancel: () => void;
  mutate: () => void;
  method?: string;
}> = ({
  current,
  projectOptions,
  apiEndpoint,
  cancel,
  mutate,
  method = "POST",
  additionalMessage,
  ctaEnabled = true,
}) => {
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      project: current || "",
    },
  });

  return (
    <Modal
      header={"Edit Project"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await apiCall(apiEndpoint, {
          method,
          body: JSON.stringify(data),
        });
        mutate();
      })}
      cta="Save"
      ctaEnabled={ctaEnabled}
    >
      {additionalMessage}
      <SelectField
        label="Project"
        value={form.watch("project")}
        onChange={(v) => form.setValue("project", v)}
        options={projectOptions.map((p) => ({ label: p.name, value: p.id }))}
        initialOption="None"
        autoFocus={true}
      />
    </Modal>
  );
};

export default EditProjectForm;
