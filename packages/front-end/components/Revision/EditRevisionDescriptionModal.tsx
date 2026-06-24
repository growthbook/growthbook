import { Revision } from "shared/enterprise";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export interface Props {
  revision: Revision;
  close: () => void;
  mutate: () => void | Promise<void>;
}

export default function EditRevisionDescriptionModal({
  revision,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const [description, setDescription] = useState(revision.comment || "");

  return (
    <ModalStandard
      trackingEventModalType="edit-revision-description"
      open={true}
      close={close}
      header="Edit Revision Description"
      cta="Save"
      submit={async () => {
        await apiCall(`/revision/${revision.id}/description`, {
          method: "PATCH",
          body: JSON.stringify({
            description,
          }),
        });
        await mutate();
      }}
    >
      <MarkdownInput
        value={description}
        setValue={setDescription}
        placeholder="Describe this revision..."
        showButtons={false}
      />
    </ModalStandard>
  );
}
