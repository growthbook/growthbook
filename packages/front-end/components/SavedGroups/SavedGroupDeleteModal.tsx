import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { isEmpty } from "lodash";
import { Text } from "@radix-ui/themes";
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";
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
  const { references, loading } = useSavedGroupReferences(savedGroup.id);

  const referencingFeatures = references?.features ?? [];
  const referencingExperiments = references?.experiments ?? [];
  const referencingSavedGroups = references?.savedGroups ?? [];

  const hasReferences =
    !isEmpty(referencingFeatures) ||
    !isEmpty(referencingExperiments) ||
    !isEmpty(referencingSavedGroups);

  const canDelete = !loading && !hasReferences;

  return (
    <Modal
      trackingEventModalType=""
      header={
        <OverflowText maxWidth={400}>
          Delete <em>{savedGroup.groupName}</em>
        </OverflowText>
      }
      close={close}
      open={true}
      cta="Delete"
      submitColor="danger"
      submit={async () => {
        await onDelete();
        close();
      }}
      ctaEnabled={canDelete}
      useRadixButton={true}
    >
      {loading ? (
        <Text color="gray">
          <LoadingSpinner /> Checking saved group references...
        </Text>
      ) : hasReferences ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="bold" mb="2">
              Cannot delete saved group
            </Text>
            <Text as="p" mb="0">
              Before you can delete this group, you will need to remove any
              references to it. Check the following item
              {referencingFeatures.length +
                referencingExperiments.length +
                referencingSavedGroups.length >
                1 && "s"}{" "}
              below:
            </Text>
          </Callout>
          <SavedGroupReferencesList
            features={referencingFeatures}
            experiments={referencingExperiments}
            savedGroups={referencingSavedGroups}
          />
        </>
      ) : (
        <p>Are you sure? This action cannot be undone.</p>
      )}
    </Modal>
  );
}
