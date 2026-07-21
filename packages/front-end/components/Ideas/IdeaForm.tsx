import { FC } from "react";
import { IdeaInterface } from "shared/types/idea";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import TagsInput from "@/components/Tags/TagsInput";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

const IdeaForm: FC<{
  idea: Partial<IdeaInterface>;
  mutate: () => void;
  close: () => void;
}> = ({ idea, close, mutate }) => {
  const { refreshTags, project, projects } = useDefinitions();

  const form = useForm({
    defaultValues: {
      text: idea.text || "",
      tags: idea.tags || [],
      project: idea.project || project || "",
    },
  });

  const edit = !!idea.id;

  const { apiCall } = useAuth();
  const submit = form.handleSubmit(async (value) => {
    const body = {
      ...value,
    };

    await apiCall<{ status: number; message?: string }>(
      edit ? `/idea/${idea.id}` : `/ideas`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    mutate();
    refreshTags(value.tags);
  });

  return (
    <Modal
      useRadixButton={false}
      trackingEventModalType=""
      header={edit ? "Edit Idea" : "New Idea"}
      close={close}
      open={true}
      submit={submit}
      cta={edit ? "Save" : "Create"}
      closeCta="Cancel"
    >
      <Field
        size="legacy"
        required
        {...form.register("text")}
        helpText="You'll be able to add more details later"
      />
      {edit && (
        <SelectField
          size="legacy"
          label="Project"
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          isClearable
          placeholder="None"
          value={form.watch("project")}
          onChange={(value) => form.setValue("project", value)}
        />
      )}
      <div className="form-group">
        <label>Tags</label>
        <TagsInput
          value={form.watch("tags")}
          onChange={(tags) => form.setValue("tags", tags)}
        />
      </div>
    </Modal>
  );
};

export default IdeaForm;
