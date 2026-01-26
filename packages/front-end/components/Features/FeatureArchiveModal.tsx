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

interface FeatureArchiveModalProps {
  feature: FeatureInterface;
  close: () => void;
  onArchive: () => Promise<void>;
  environments: string[];
}

export default function FeatureArchiveModal({
  feature,
  close,
  onArchive,
  environments,
}: FeatureArchiveModalProps) {
  const { features, loading: featuresLoading } = useFeaturesList({
    useCurrentProject: false,
  });
  const { experiments } = useExperiments();

  const dependentFeatures = useMemo(() => {
    if (featuresLoading || !features) return [];
    return getDependentFeatures(feature, features, environments);
  }, [feature, features, environments, featuresLoading]);

  const dependentExperiments = useMemo(() => {
    if (!experiments) return [];
    return getDependentExperiments(feature, experiments);
  }, [feature, experiments]);

  const dependents = dependentFeatures.length + dependentExperiments.length;
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
      ctaEnabled={!featuresLoading && dependents === 0}
      increasedElevation={true}
    >
      {featuresLoading ? (
        <Text color="gray">
          <LoadingSpinner /> Checking feature dependencies...
        </Text>
      ) : dependents > 0 ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="bold" mb="2">
              Cannot {isArchived ? "unarchive" : "archive"} feature
            </Text>
            <Text as="p" mb="0">
              Before you can {isArchived ? "unarchive" : "archive"} this
              feature, you will need to remove any references to it. Check the
              following item
              {dependents > 1 && "s"} below:
            </Text>
          </Callout>
          <FeatureReferencesList
            features={dependentFeatures}
            experiments={dependentExperiments}
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
