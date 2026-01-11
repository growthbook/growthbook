import { FeatureInterface } from "shared/types/feature";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

export default function StaleDetectionModal({
  close,
  feature,
  mutate,
}: {
  close: () => void;
  feature: Pick<FeatureInterface, "id" | "neverStale">;
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
    >
      <p>
        {feature.neverStale
          ? `This will enable stale feature flag detection for ${feature.id}. After two weeks with no changes, if the feature flag meets certain criteria we will mark it as stale.`
          : `This will disable stale feature flag detection for ${feature.id}. The feature flag will be ignored by our detection algorithm and not be marked as stale. You can re-enable this at any time.`}
      </p>
    </Modal>
  );
}
