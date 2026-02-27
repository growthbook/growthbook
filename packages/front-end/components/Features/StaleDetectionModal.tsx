import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

export default function StaleDetectionModal({
  close,
  feature,
  mutate,
}: {
  close: () => void;
  feature: { id: string; neverStale?: boolean };
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  return (
    <Modal
      trackingEventModalType=""
      open
      close={close}
      header={`${
        feature.neverStale ? "Enable" : "Disable"
      } stale feature flag detection for ${feature.id}`}
      cta={feature.neverStale ? "Enable" : "Disable"}
      submit={async () => {
        await apiCall(`/feature/${feature.id}/toggleStaleDetection`, {
          method: "POST",
        });
        mutate();
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
