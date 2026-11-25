import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { isEmpty } from "lodash";
import { Text } from "@radix-ui/themes";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  totalSavedGroupReferences,
  useSavedGroupReferences,
} from "@/hooks/useSavedGroupReferences";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import SavedGroupReferencesList from "./SavedGroupReferencesList";

interface SavedGroupDeleteModalProps {
  savedGroup: SavedGroupInterface | SavedGroupWithoutValues;
  close: () => void;
  onDelete: () => Promise<void>;
}

export default function SavedGroupDeleteModal({
  savedGroup,
  close,
  onDelete,
}: SavedGroupDeleteModalProps) {
  const { t } = useLingui();
  const { references, loading } = useSavedGroupReferences(savedGroup.id);

  const referencingFeatures = references?.features ?? [];
  const referencingExperiments = references?.experiments ?? [];
  const referencingBandits = references?.contextualBandits ?? [];
  const referencingInterleavings = references?.interleavings ?? [];
  const referencingSavedGroups = references?.savedGroups ?? [];

  const hasReferences =
    !isEmpty(referencingFeatures) ||
    !isEmpty(referencingExperiments) ||
    !isEmpty(referencingBandits) ||
    !isEmpty(referencingInterleavings) ||
    !isEmpty(referencingSavedGroups);

  const canDelete = !loading && !hasReferences;
  const referenceCount = totalSavedGroupReferences(references);

  return (
    <Modal
      trackingEventModalType=""
      header={
        <OverflowText maxWidth={400}>
          <Trans>
            Delete <em>{savedGroup.groupName}</em>
          </Trans>
        </OverflowText>
      }
      close={close}
      open={true}
      cta={t`Delete`}
      submitColor="danger"
      submit={async () => {
        await onDelete();
        close();
      }}
      ctaEnabled={canDelete}
    >
      {loading ? (
        <Text color="gray">
          <LoadingSpinner /> <Trans>Checking Saved Group references...</Trans>
        </Text>
      ) : hasReferences ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="bold" mb="2">
              <Trans>Cannot delete Saved Group</Trans>
            </Text>
            <Text as="p" mb="0">
              <Plural
                value={referenceCount}
                one="Before you can delete this group, you will need to remove any references to it. Check the following item below:"
                other="Before you can delete this group, you will need to remove any references to it. Check the following items below:"
              />
            </Text>
          </Callout>
          <SavedGroupReferencesList
            features={referencingFeatures}
            experiments={referencingExperiments}
            contextualBandits={referencingBandits}
            interleavings={referencingInterleavings}
            savedGroups={referencingSavedGroups}
          />
        </>
      ) : (
        <p>
          <Trans>Are you sure? This action cannot be undone.</Trans>
        </p>
      )}
    </Modal>
  );
}
