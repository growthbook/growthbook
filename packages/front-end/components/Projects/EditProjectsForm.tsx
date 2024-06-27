import { FC } from "react";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";

const EditProjectsForm: FC<{
  value: string[];
  permissionRequired: (projectId: string) => boolean;
  save: (projects: string[]) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
  entityName?: string;
}> = ({ value = [], permissionRequired, save, cancel, mutate, entityName }) => {
  const { projects: orgProjects } = useDefinitions();
  const form = useForm({
    defaultValues: {
      projects: value,
    },
  });

  const projectOptions = orgProjects.filter((project) =>
    permissionRequired(project.id)
  );

  return (
    <Modal
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
        label="Projects"
        placeholder="All projects"
        value={form.watch("projects")}
        options={projectOptions.map((p) => ({
          value: p.id,
          label: p.name,
        }))}
        onChange={(v) => form.setValue("projects", v)}
        customClassName="label-overflow-ellipsis"
        helpText={`Assign this ${entityName} to specific projects`}
      />
      <div style={{ height: 200 }} />
    </Modal>
  );
};

export default EditProjectsForm;
