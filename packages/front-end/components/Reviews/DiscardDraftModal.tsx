import { Trans, useLingui } from "@lingui/react/macro";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export default function DiscardDraftModal({
  trackingEventModalType,
  discard,
  close,
}: {
  trackingEventModalType: string;
  discard: () => Promise<void>;
  close: () => void;
}) {
  const { t } = useLingui();
  return (
    <ModalStandard
      trackingEventModalType={trackingEventModalType}
      open={true}
      header={t`Discard Draft`}
      cta={t`Discard`}
      ctaColor="red"
      close={close}
      submit={discard}
    >
      <Trans>
        Are you sure you want to discard this draft? This action cannot be
        undone.
      </Trans>
    </ModalStandard>
  );
}
