import { FC, ReactElement } from "react";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import useProjectOptions from "@/hooks/useProjectOptions";

const EditProjectsForm: FC<{
  value: string[];
  permissionRequired: (projectId: string) => boolean;
  save: (projects: string[]) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
  label: ReactElement;
  entityName?: string;
}> = ({
  value = [],
  permissionRequired,
  save,
  cancel,
  mutate,
  entityName,
  label,
}) => {
  const form = useForm({
    defaultValues: {
      projects: value,
    },
  });

  return (
    <Modal
      trackingEventModalType=""
      header={"Edit Projects"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data.projects);
        mutate();
      })}
      cta="Save"
    >
      <MultiSelectField
        label={label}
        placeholder="All projects"
        value={form.watch("projects")}
        options={useProjectOptions(permissionRequired, value)}
        onChange={(v) => form.setValue("projects", v)}
        customClassName="label-overflow-ellipsis"
        helpText={`Assign this ${entityName} to specific projects`}
      />
      <div style={{ height: 200 }} />
    </Modal>
  );
};

export default EditProjectsForm;
