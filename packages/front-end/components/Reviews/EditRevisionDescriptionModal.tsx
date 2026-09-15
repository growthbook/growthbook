import { useState } from "react";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

// Shared "edit revision description" modal. Entity-agnostic: the caller owns
// the persistence via `onSubmit`, so the same modal serves features
// (PUT /feature/:id/:v/comment) and saved groups (PATCH /revision/:id/description).
export default function EditRevisionDescriptionModal({
  initialValue,
  onSubmit,
  close,
  trackingEventModalType = "edit-revision-description",
  header = "Edit Revision Description",
  placeholder = "Describe this revision...",
}: {
  initialValue: string;
  onSubmit: (value: string) => void | Promise<void>;
  close: () => void;
  trackingEventModalType?: string;
  header?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <ModalStandard
      trackingEventModalType={trackingEventModalType}
      open={true}
      close={close}
      header={header}
      cta="Save"
      submit={async () => {
        await onSubmit(value);
      }}
    >
      <MarkdownInput
        value={value}
        setValue={setValue}
        placeholder={placeholder}
        showButtons={false}
      />
    </ModalStandard>
  );
}
