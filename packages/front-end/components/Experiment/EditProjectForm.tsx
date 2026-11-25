import { FC, ReactElement } from "react";
import { useForm } from "react-hook-form";
import { useLingui } from "@lingui/react/macro";
import SelectField from "@/components/Forms/SelectField";
import useProjectOptions from "@/hooks/useProjectOptions";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

const EditProjectForm: FC<{
  save: (project: string) => Promise<unknown>;
  label: ReactElement;
  permissionRequired: (projectId: string) => boolean;
  current?: string;
  additionalMessage?: string | ReactElement | null;
  ctaEnabled?: boolean;
  cancel: () => void;
  mutate: () => void;
  source?: string;
}> = ({
  current,
  save,
  permissionRequired,
  cancel,
  mutate,
  additionalMessage,
  ctaEnabled = true,
  label,
  source,
}) => {
  const { t } = useLingui();
  const form = useForm({
    defaultValues: {
      project: current || "",
    },
  });

  // If user has the permission required globally (E.G. canCreateFeature), show the "None" option, otherwise, don't show initial option
  const initialOption = permissionRequired("") ? t`None` : "";

  return (
    <ModalStandard
      trackingEventModalType="edit-project-form"
      trackingEventModalSource={source}
      header={t`Edit Project`}
      open={true}
      close={cancel}
      submit={validatedSubmit(form, async (data) => {
        await save(data.project);
        mutate();
      })}
      cta={t`Save`}
      ctaEnabled={ctaEnabled}
    >
      {additionalMessage}
      <SelectField
        size="legacy"
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
