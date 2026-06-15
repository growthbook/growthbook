import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  close: () => void;
  mutate: () => void;
}

export default function EditRevisionCommentModal({
  feature,
  revision,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const [comment, setComment] = useState(revision.comment || "");

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header="Edit Revision Description"
      cta="Save"
      submit={async () => {
        await apiCall(`/feature/${feature.id}/${revision.version}/comment`, {
          method: "PUT",
          body: JSON.stringify({
            comment,
          }),
        });
        mutate();
      }}
    >
      <MarkdownInput
        value={comment}
        setValue={setComment}
        placeholder="Describe this revision..."
        showButtons={false}
      />
    </ModalStandard>
  );
}
