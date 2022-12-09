import { FC, useState } from "react";
import { DiscussionParentType } from "back-end/types/discussion";
import { useForm } from "react-hook-form";
import { useAuth } from "../services/auth";
import LoadingOverlay from "./LoadingOverlay";
import MarkdownInput from "./Markdown/MarkdownInput";

const CommentForm: FC<{
  cta: string;
  type: DiscussionParentType;
  id: string;
  index: number;
  initialValue?: string;
  autofocus?: boolean;
  onSave: () => void;
  onCancel?: () => void;
}> = ({ cta, type, id, index, initialValue, autofocus, onSave, onCancel }) => {
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      comment: initialValue || "",
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit(async (value) => {
        const comment = value.comment;
        if (loading || comment.length < 1) return;
        setLoading(true);
        setFormError(null);
        try {
          if (index >= 0) {
            await apiCall(`/discussion/${type}/${id}/${index}`, {
              method: "PUT",
              body: JSON.stringify({ comment }),
            });
          } else {
            await apiCall(`/discussion/${type}/${id}`, {
              method: "POST",
              body: JSON.stringify({ comment }),
            });
          }
          form.setValue("comment", "");
          onSave();
        } catch (e) {
          setFormError(e.message || "Error saving comment");
        }

        setLoading(false);
      })}
    >
      {loading && <LoadingOverlay />}
      <MarkdownInput
        value={form.watch("comment")}
        setValue={(comment) => form.setValue("comment", comment)}
        autofocus={autofocus}
        cta={cta}
        onCancel={onCancel}
        error={formError}
      />
    </form>
  );
};
export default CommentForm;
