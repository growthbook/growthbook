import { FC } from "react";
import { IdeaInterface } from "back-end/types/idea";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import TagsInput from "../TagsInput";
import { useDefinitions } from "../../services/DefinitionsContext";

const IdeaForm: FC<{
  idea: Partial<IdeaInterface>;
  mutate: () => void;
  close: () => void;
}> = ({ idea, close, mutate }) => {
  const form = useForm({
    defaultValues: {
      text: idea.text || "",
      tags: idea.tags || [],
    },
  });

  const edit = !!idea.id;

  const { apiCall } = useAuth();
  const { refreshTags } = useDefinitions();

  const submit = form.handleSubmit(async (value) => {
    const body = {
      ...value,
    };

    await apiCall<{ status: number; message?: string }>(
      edit ? `/idea/${idea.id}` : `/ideas`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    mutate();
    refreshTags(value.tags);
  });

  return (
    <Modal
      header={edit ? "Edit Idea" : "New Idea"}
      close={close}
      open={true}
      submit={submit}
      cta={edit ? "Save" : "Create"}
      closeCta="Cancel"
    >
      <div className={`form-group`}>
        <label>Short Description</label>
        <input
          type="text"
          required
          className="form-control"
          {...form.register("text")}
        />
        <small className="form-text text-muted">
          You&apos;ll be able to add more details later
        </small>
      </div>
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
