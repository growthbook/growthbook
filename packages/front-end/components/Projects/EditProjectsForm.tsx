import { FC } from "react";
import { useForm } from "react-hook-form";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";

const EditProjectsForm: FC<{
  projects: string[];
  save: (projects: string[]) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
  entityName?: string;
}> = ({ projects = [], save, cancel, mutate, entityName }) => {
  const { projects: projectDefinitions } = useDefinitions();
  const form = useForm({
    defaultValues: {
      projects,
    },
  });

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
        options={projectDefinitions.map((p) => ({
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
