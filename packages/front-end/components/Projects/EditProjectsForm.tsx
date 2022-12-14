import { FC } from "react";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import MultiSelectField from "../Forms/MultiSelectField";

const EditProjectsForm: FC<{
  projects: string[];
  save: (projects: string[]) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
}> = ({ projects = [], save, cancel, mutate }) => {
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
      <label>Projects (optional)</label>
      <MultiSelectField
        value={form.watch("projects")}
        options={projectDefinitions.map((p) => ({
          value: p.id,
          label: p.name,
        }))}
        onChange={(v) => form.setValue("projects", v)}
        customClassName="label-overflow-ellipsis"
        helpText="Limit this metric to specific projects"
      />
      <div style={{ height: 200 }} />
    </Modal>
  );
};

export default EditProjectsForm;
