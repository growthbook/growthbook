import { FC } from "react";
import { DiscussionParentType } from "shared/types/discussion";
import { useAuth } from "@/services/auth";
import CommentComposer from "./Comments/CommentComposer";

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
  const { apiCall } = useAuth();

  return (
    <CommentComposer
      cta={cta}
      initialValue={initialValue}
      autofocus={autofocus}
      onCancel={onCancel}
      onSubmit={async (comment) => {
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
        onSave();
      }}
    />
  );
};

export default CommentForm;
