import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const [value, setValue] = useState(initialValue);

  return (
    <ModalStandard
      trackingEventModalType={trackingEventModalType}
      open={true}
      close={close}
      // Which revision, by its current name, as the review tab names it.
      header={
        <Trans>
          Rename <NamedRevision version={version} title={initialValue} />
        </Trans>
      }
      cta={t`Save`}
      submit={async () => {
        await onSubmit(value.trim());
      }}
    >
      <TextField
        label={t`Name`}
        autoFocus
        value={value}
        placeholder={t`Revision ${version}`}
        onChange={(e) => setValue(e.target.value)}
      />
    </ModalStandard>
  );
}
