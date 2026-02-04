import { useMemo } from "react";
import { FeatureInterface } from "shared/types/feature";
import { getDependentExperiments, getDependentFeatures } from "shared/util";
import { Text } from "@radix-ui/themes";
import { useFeaturesList } from "@/services/features";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import FeatureReferencesList from "./FeatureReferencesList";

interface FeatureDeleteModalProps {
  feature: FeatureInterface;
  close: () => void;
  onDelete: () => Promise<void>;
  environments: string[];
}

export default function FeatureDeleteModal({
  feature,
  close,
  onDelete,
  environments,
}: FeatureDeleteModalProps) {
  const { features, loading: featuresLoading } = useFeaturesList({
    useCurrentProject: false,
  });
  const { experiments, loading: experimentsLoading } = useExperiments();

  const dependentFeatures = useMemo(() => {
    if (featuresLoading || !features) return [];
    return getDependentFeatures(feature, features, environments);
  }, [feature, features, environments, featuresLoading]);

  const dependentExperiments = useMemo(() => {
    if (experimentsLoading || !experiments) return [];
    return getDependentExperiments(feature, experiments);
  }, [feature, experiments, experimentsLoading]);

  const dependents = dependentFeatures.length + dependentExperiments.length;

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
      ctaEnabled={!featuresLoading && !experimentsLoading && dependents === 0}
      useRadixButton={true}
    >
      {featuresLoading || experimentsLoading ? (
        <Text color="gray">
          <LoadingSpinner /> Checking feature dependencies...
        </Text>
      ) : dependents > 0 ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="bold" mb="2">
              Cannot delete feature
            </Text>
            <Text as="p" mb="0">
              Before you can delete this feature, you will need to remove any
              references to it. Check the following item
              {dependents > 1 && "s"} below:
            </Text>
          </Callout>
          <FeatureReferencesList
            features={dependentFeatures}
            experiments={dependentExperiments}
          />
        </>
      ) : (
        <p>Are you sure? This action cannot be undone.</p>
      )}
    </Modal>
  );
}
