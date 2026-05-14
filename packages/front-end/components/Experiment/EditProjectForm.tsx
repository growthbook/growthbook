import { FC, ReactElement } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import SelectField from "@/components/Forms/SelectField";
import useProjectOptions from "@/hooks/useProjectOptions";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

const EditProjectForm: FC<{
  apiEndpoint: string;
  label: ReactElement;
  permissionRequired: (projectId: string) => boolean;
  current?: string;
  additionalMessage?: string | ReactElement | null;
  ctaEnabled?: boolean;
  cancel: () => void;
  mutate: () => void;
  method?: string;
  source?: string;
}> = ({
  current,
  apiEndpoint,
  permissionRequired,
  cancel,
  mutate,
  method = "POST",
  additionalMessage,
  ctaEnabled = true,
  label,
  source,
}) => {
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      project: current || "",
    },
  });

  // If user has the permission required globally (E.G. canCreateFeature), show the "None" option, otherwise, don't show initial option
  const initialOption = permissionRequired("") ? "None" : "";

  return (
    <ModalStandard
      trackingEventModalType="edit-project-form"
      trackingEventModalSource={source}
      header="Edit Project"
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
        label={label}
        value={form.watch("project")}
        onChange={(v) => form.setValue("project", v)}
        options={useProjectOptions(
          permissionRequired,
          current ? [current] : [],
        )}
        initialOption={initialOption}
        autoFocus={true}
      />
    </ModalStandard>
  );
};

export default EditProjectForm;
