import { FeatureInterface } from "shared/types/feature";
import { Text } from "@radix-ui/themes";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import FeatureReferencesList from "./FeatureReferencesList";

interface FeatureArchiveModalProps {
  feature: FeatureInterface;
  close: () => void;
  onArchive: () => Promise<void>;
}

export default function FeatureArchiveModal({
  feature,
  close,
  onArchive,
}: FeatureArchiveModalProps) {
  const { dependents, loading } = useFeatureDependents(feature.id);
  const totalDependents =
    (dependents?.features.length ?? 0) + (dependents?.experiments.length ?? 0);
  const isArchived = feature.archived;

  return (
    <Modal
      trackingEventModalType=""
      header={isArchived ? "Unarchive Feature" : "Archive Feature"}
      close={close}
      open={true}
      cta={isArchived ? "Unarchive" : "Archive"}
      submitColor="danger"
      submit={async () => {
        await onArchive();
        close();
      }}
      ctaEnabled={!loading && totalDependents === 0}
      useRadixButton={true}
    >
      {loading ? (
        <Text color="gray">
          <LoadingSpinner /> Checking feature dependencies...
        </Text>
      ) : totalDependents > 0 ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="bold" mb="2">
              Cannot {isArchived ? "unarchive" : "archive"} feature
            </Text>
            <Text as="p" mb="0">
              Before you can {isArchived ? "unarchive" : "archive"} this
              feature, you will need to remove any references to it. Check the
              following item
              {totalDependents > 1 && "s"} below:
            </Text>
          </Callout>
          <FeatureReferencesList
            features={dependents?.features}
            experiments={dependents?.experiments}
          />
        </>
      ) : isArchived ? (
        <p>
          Are you sure you want to continue? This will make the current feature
          active again.
        </p>
      ) : (
        <p>
          Are you sure you want to continue? This will make the current feature
          inactive. It will not be included in API responses or Webhook
          payloads.
        </p>
      )}
    </Modal>
  );
}
