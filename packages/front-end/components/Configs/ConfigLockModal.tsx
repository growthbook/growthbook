import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const [reason, setReason] = useState("");
  return (
    <ModalStandard
      trackingEventModalType="config-lock"
      open={true}
      close={close}
      header={t`Lock "${configName}"`}
      cta={t`Lock`}
      submit={async () => {
        await onConfirm(reason.trim() || undefined);
      }}
    >
      <p>
        <Trans>Nothing can be published until you unlock.</Trans>
      </p>
      <Field
        label={t`Reason (optional)`}
        textarea
        minRows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t`Why lock this Config?`}
      />
    </ModalStandard>
  );
}
