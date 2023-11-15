import { FeatureInterface } from "back-end/types/feature";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";

export default function StaleDetectionModal({
  close,
  feature,
  mutate,
}: {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  return (
    <Modal
      open
      close={close}
      header={`${
        feature.neverStale ? "Enable" : "Disable"
      } Stale Feature Flag Detection`}
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
          ? "This will enable stale feature flag detection for this feature. After two weeks of no updates, if the feature flag meets certain criteria we will mark it as stale."
          : "This will disable stale feature flag detection. The feature flag will be ignored by our detection algorithm and never be marked as stale."}
      </p>
    </Modal>
  );
}
