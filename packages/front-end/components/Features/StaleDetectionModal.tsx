import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

export default function StaleDetectionModal({
  close,
  feature,
  mutate,
  onEnable,
}: {
  close: () => void;
  feature: { id: string; neverStale?: boolean };
  mutate: () => void;
  /** Called after enabling detection (neverStale: true → false) */
  onEnable?: () => void;
}) {
  const { apiCall } = useAuth();
  const enabling = !!feature.neverStale;
  return (
    <Modal
      trackingEventModalType=""
      open
      close={close}
      header={`${
        enabling ? "Enable" : "Disable"
      } stale feature flag detection for ${feature.id}`}
      cta={enabling ? "Enable" : "Disable"}
      submit={async () => {
        await apiCall(`/feature/${feature.id}/toggleStaleDetection`, {
          method: "POST",
        });
        mutate();
        if (enabling) onEnable?.();
      }}
      useRadixButton={true}
    >
      <p>
        {feature.neverStale
          ? `Enable stale detection for ${feature.id}?`
          : `Disable stale detection for ${feature.id}? It will no longer be marked as stale.`}
      </p>
    </Modal>
  );
}
