import { FC } from "react";
import { IdeaInterface } from "back-end/types/idea";
import useForm from "../../hooks/useForm";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import TagsInput from "../TagsInput";
import { useTags } from "../../services/TagsContext";

const IdeaForm: FC<{
  idea: Partial<IdeaInterface>;
  mutate: () => void;
  close: () => void;
}> = ({ idea, close, mutate }) => {
  const [value, inputProps, manualUpdate] = useForm(
    {
      text: idea.text || "",
      tags: idea.tags || [],
    },
    idea.id || "new",
    {
      className: "form-control",
    }
  );

  const edit = !!idea.id;

  const { apiCall } = useAuth();
  const { refreshTags } = useTags();

  const submit = async () => {
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
    refreshTags();
  };

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
        <input type="text" required {...inputProps.text} />
        <small className="form-text text-muted">
          You&apos;ll be able to add more details later
        </small>
      </div>
      <div className="form-group">
        <label>Tags</label>
        <TagsInput
          value={value.tags}
          onChange={(tags) => {
            manualUpdate({ tags });
          }}
        />
      </div>
    </Modal>
  );
};

export default IdeaForm;
