import { useState } from "react";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export default function ConfigLockModal({
  configName,
  onConfirm,
  close,
}: {
  configName: string;
  onConfirm: (reason?: string) => Promise<void>;
  close: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <ModalStandard
      trackingEventModalType="config-lock"
      open={true}
      close={close}
      header={`Lock "${configName}"`}
      cta="Lock"
      submit={async () => {
        await onConfirm(reason.trim() || undefined);
      }}
    >
      <p>Nothing can be published until you unlock.</p>
      <Field
        label="Reason (optional)"
        textarea
        minRows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why lock this config?"
      />
    </ModalStandard>
  );
}
