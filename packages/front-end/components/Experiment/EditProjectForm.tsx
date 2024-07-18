import { FC, ReactElement } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import useProjectOptions from "@/hooks/useProjectOptions";

const EditProjectForm: FC<{
  apiEndpoint: string;
  permissionRequired: (projectId: string) => boolean;
  current?: string;
  additionalMessage?: string | ReactElement | null;
  ctaEnabled?: boolean;
  cancel: () => void;
  mutate: () => void;
  method?: string;
}> = ({
  current,
  apiEndpoint,
  permissionRequired,
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
        options={useProjectOptions(
          permissionRequired,
          current ? [current] : []
        )}
        initialOption="None"
        autoFocus={true}
      />
    </Modal>
  );
};

export default EditProjectForm;
