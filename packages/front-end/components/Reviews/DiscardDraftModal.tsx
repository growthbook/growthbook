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
  return (
    <ModalStandard
      trackingEventModalType={trackingEventModalType}
      open={true}
      header="Discard Draft"
      cta="Discard"
      ctaColor="red"
      close={close}
      submit={discard}
    >
      Are you sure you want to discard this draft? This action cannot be undone.
    </ModalStandard>
  );
}
