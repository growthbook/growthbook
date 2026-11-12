import { useState } from "react";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { NamedRevision } from "@/components/Reviews/RevisionLabel";

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
      // Which revision, by its current name, as the review tab names it.
      header={
        <>
          Rename <NamedRevision version={version} title={initialValue} />
        </>
      }
      cta="Save"
      submit={async () => {
        await onSubmit(value.trim());
      }}
    >
      <TextField
        label="Name"
        autoFocus
        value={value}
        placeholder={`Revision ${version}`}
        onChange={(e) => setValue(e.target.value)}
      />
    </ModalStandard>
  );
}
