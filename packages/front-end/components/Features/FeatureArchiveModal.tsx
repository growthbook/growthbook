import { FeatureInterface } from "shared/types/feature";
import { useState } from "react";
import Text from "@/ui/Text";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import Checkbox from "@/ui/Checkbox";
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

  const environments = useEnvironments();
  const enabledEnvs = isArchived
    ? []
    : getEnabledEnvironments(feature, environments);
  const hasActiveEnvs = enabledEnvs.length > 0;

  // If there are active environments, must explicitly confirm with a checkbox to enable the CTA
  const [confirmEnvBypass, setConfirmEnvBypass] = useState(!hasActiveEnvs);

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
      ctaEnabled={
        !loading &&
        totalDependents === 0 &&
        (confirmEnvBypass || !hasActiveEnvs)
      }
      useRadixButton={true}
    >
      {loading ? (
        <Text color="text-disabled">
          <LoadingSpinner /> Checking feature dependencies...
        </Text>
      ) : hasActiveEnvs ? (
        <>
          <Text as="p" mb="4">
            Are you sure you want to continue? This will completely remove the
            feature from all SDKs and webhooks.
          </Text>
          <Callout status="warning" mb="4">
            This feature is still active in the following environments:{" "}
            <strong>{enabledEnvs.join(", ")}</strong>.
          </Callout>
          <Checkbox
            value={confirmEnvBypass}
            setValue={setConfirmEnvBypass}
            label="I understand that all environments will be immediately disabled after archiving."
          />
        </>
      ) : totalDependents > 0 ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="semibold" mb="2">
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
