import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

export default function StaleDetectionModal({
  close,
  feature,
  mutate,
  setVersion,
  onEnable,
}: {
  close: () => void;
  feature: { id: string; neverStale?: boolean };
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
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
        const res = await apiCall<{ version?: number }>(
          `/feature/${feature.id}/toggleStaleDetection`,
          { method: "POST" },
        );
        await mutate();
        if (res?.version) setVersion(res.version);
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
