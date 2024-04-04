import { FC } from "react";
import { useForm } from "react-hook-form";
import { ProjectInterface } from "@back-end/types/project";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";

const EditProjectsForm: FC<{
  currentProjects: string[];
  save: (projects: string[]) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
  projectOptions?: ProjectInterface[];
  entityName?: string;
}> = ({
  currentProjects = [],
  save,
  cancel,
  mutate,
  entityName,
  projectOptions,
}) => {
  const { projects: projectDefinitions } = useDefinitions();
  const form = useForm({
    defaultValues: {
      projects: currentProjects,
    },
  });
  const projectsList = projectOptions || projectDefinitions;

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
        options={projectsList.map((p) => ({
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
