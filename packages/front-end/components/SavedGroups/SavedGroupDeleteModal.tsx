import { useMemo } from "react";
import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import {
  experimentsReferencingSavedGroups,
  featuresReferencingSavedGroups,
} from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isEmpty } from "lodash";
import { Text } from "@radix-ui/themes";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
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

// Hook to fetch references and determine if deletion is allowed
function useSavedGroupReferences(
  savedGroup: SavedGroupInterface | SavedGroupWithoutValues,
) {
  const { features, loading: featuresLoading } = useFeaturesList({
    useCurrentProject: false,
  });
  const { experiments, loading: experimentsLoading } = useExperiments();
  const environments = useEnvironments();
  const { savedGroups: allSavedGroups } = useDefinitions();

  // Find saved groups that reference the target
  const savedGroupsReferencingTarget = useMemo(() => {
    if (!allSavedGroups) return [];
    return allSavedGroups.filter((sg) => {
      if (sg.id === savedGroup.id) return false;
      if (!sg.condition) return false;
      return sg.condition.includes(savedGroup.id);
    });
  }, [savedGroup, allSavedGroups]);

  // Find features that reference the target (directly or via other saved groups)
  const referencingFeatures = useMemo(() => {
    if (featuresLoading) return [];
    const savedGroupsToCheck = [
      savedGroup as SavedGroupInterface,
      ...savedGroupsReferencingTarget,
    ];
    const referenceMap = featuresReferencingSavedGroups({
      savedGroups: savedGroupsToCheck,
      features,
      environments,
    });
    const allFeatures = new Map<string, FeatureInterface>();
    savedGroupsToCheck.forEach((sg) => {
      (referenceMap[sg.id] || []).forEach((feature) => {
        allFeatures.set(feature.id, feature);
      });
    });
    return Array.from(allFeatures.values());
  }, [
    savedGroup,
    savedGroupsReferencingTarget,
    features,
    environments,
    featuresLoading,
  ]);

  // Find experiments that reference the target (directly or via other saved groups)
  const referencingExperiments = useMemo(() => {
    if (experimentsLoading) return [];
    const savedGroupsToCheck = [
      savedGroup as SavedGroupInterface,
      ...savedGroupsReferencingTarget,
    ];
    const referenceMap = experimentsReferencingSavedGroups({
      savedGroups: savedGroupsToCheck,
      experiments,
    });
    const allExperiments = new Map<string, ExperimentInterfaceStringDates>();
    savedGroupsToCheck.forEach((sg) => {
      const experimentsForGroup = (referenceMap[sg.id] ||
        []) as ExperimentInterfaceStringDates[];
      experimentsForGroup.forEach((experiment) => {
        allExperiments.set(experiment.id, experiment);
      });
    });
    return Array.from(allExperiments.values());
  }, [
    savedGroup,
    savedGroupsReferencingTarget,
    experiments,
    experimentsLoading,
  ]);

  // Saved groups that reference the target
  const referencingSavedGroups = useMemo(() => {
    return savedGroupsReferencingTarget.filter((sg) => sg.id !== savedGroup.id);
  }, [savedGroupsReferencingTarget, savedGroup.id]);

  const canDelete =
    !featuresLoading &&
    !experimentsLoading &&
    isEmpty(referencingFeatures) &&
    isEmpty(referencingExperiments) &&
    isEmpty(referencingSavedGroups);

  return {
    loading: featuresLoading || experimentsLoading,
    canDelete,
    referencingFeatures,
    referencingExperiments,
    referencingSavedGroups,
  };
}

export default function SavedGroupDeleteModal({
  savedGroup,
  close,
  onDelete,
}: SavedGroupDeleteModalProps) {
  const {
    loading,
    canDelete,
    referencingFeatures,
    referencingExperiments,
    referencingSavedGroups,
  } = useSavedGroupReferences(savedGroup);

  const hasReferences =
    !isEmpty(referencingFeatures) ||
    !isEmpty(referencingExperiments) ||
    !isEmpty(referencingSavedGroups);

  return (
    <Modal
      trackingEventModalType=""
      header={
        <>
          Delete{" "}
          <OverflowText>
            <em>{savedGroup.groupName}</em>
          </OverflowText>
        </>
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
      increasedElevation={true}
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
