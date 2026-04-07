import { FeatureInterface } from "shared/types/feature";
import { Text } from "@radix-ui/themes";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import FeatureReferencesList from "./FeatureReferencesList";

interface FeatureDeleteModalProps {
  feature: FeatureInterface;
  close: () => void;
  onDelete: () => Promise<void>;
}

export default function FeatureDeleteModal({
  feature,
  close,
  onDelete,
}: FeatureDeleteModalProps) {
  const { dependents, loading } = useFeatureDependents(feature.id);
  const totalDependents =
    (dependents?.features.length ?? 0) + (dependents?.experiments.length ?? 0);

  return (
    <Modal
      trackingEventModalType=""
      header="Delete Feature"
      close={close}
      open={true}
      cta="Delete"
      submitColor="danger"
      submit={async () => {
        await onDelete();
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
              Cannot delete feature
            </Text>
            <Text as="p" mb="0">
              Before you can delete this feature, you will need to remove any
              references to it. Check the following item
              {totalDependents > 1 && "s"} below:
            </Text>
          </Callout>
          <FeatureReferencesList
            features={dependents?.features}
            experiments={dependents?.experiments}
          />
        </>
      ) : (
        <p>Are you sure? This action cannot be undone.</p>
      )}
    </Modal>
  );
}
