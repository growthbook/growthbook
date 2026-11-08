import { useState } from "react";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

// Shared "rename revision" modal. Entity-agnostic like
// EditRevisionDescriptionModal: the caller owns the persistence via `onSubmit`.
export default function EditRevisionTitleModal({
  initialValue,
  version,
  onSubmit,
  close,
  trackingEventModalType = "edit-revision-title",
}: {
  initialValue: string;
  version: number;
  onSubmit: (value: string) => void | Promise<void>;
  close: () => void;
  trackingEventModalType?: string;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <ModalStandard
      trackingEventModalType={trackingEventModalType}
      open={true}
      close={close}
      header="Rename Revision"
      cta="Save"
      submit={async () => {
        await onSubmit(value.trim());
      }}
    >
      <TextField
        label="Title"
        autoFocus
        value={value}
        placeholder={`Revision ${version}`}
        onChange={(e) => setValue(e.target.value)}
      />
    </ModalStandard>
  );
}
