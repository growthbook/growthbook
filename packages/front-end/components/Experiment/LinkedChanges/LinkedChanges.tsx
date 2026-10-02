import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { useCallback, useMemo } from "react";
import { getEqualWeights } from "shared/experiments";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import LinkedFeatureFlag from "@/components/Experiment/LinkedChanges/LinkedFeatureFlag";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import { experimentVisualChangesetOwner } from "@/components/Experiment/visualChangesetOwner";
import { useAuth } from "@/services/auth";
import Avatar from "@/ui/Avatar";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import VariationsTable from "@/components/Experiment/VariationsTable";
import Button from "@/ui/Button";
import { RedirectLinkedChanges } from "./RedirectLinkedChanges";
import AddLinkedChangeButton from "./AddLinkedChangeButton";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  type LinkedChange,
} from "./constants";
import AddLinkedChanges, { type LinkedChangeTarget } from "./AddLinkedChanges";

export default function LinkedChanges({
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  experiment,
  canAddChanges,
  isPublic,
  mutate,
  canEditVisualChangesets,
  visualChangesetEnvStates,
  urlRedirectEnvStates,
  setVisualEditorModal,
  setFeatureModal,
  setUrlRedirectModal,
  onAddVariation,
  canEditExperiment,
  setEditVariationIndex,
  hideVariations,
}: {
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  experiment: ExperimentInterfaceStringDates;
  canAddChanges: boolean;
  isPublic?: boolean;
  mutate?: () => void;
  canEditVisualChangesets: boolean;
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
  setVisualEditorModal?: (state: boolean) => void;
  setFeatureModal?: (state: boolean) => void;
  setUrlRedirectModal?: (state: boolean) => void;
  onAddVariation?: () => void;
  canEditExperiment?: boolean;
  setEditVariationIndex?: (index: number) => void;
  hideVariations?: boolean;
}) {
  const { apiCall } = useAuth();
  const numLinkedChanges =
    linkedFeatures.length + visualChangesets.length + urlRedirects.length;

  // Remove a variation from the experiment AND clean up any matching
  // `visualChange` rows in every changeset. We do the experiment update
  // first (the existing edit-variations endpoint handles phase /
  // variationWeights bookkeeping); then sweep changesets that referenced
  // the deleted variation. Not atomic across the two writes — but a
  // partial failure leaves orphan visualChanges that are harmless
  // (the UI filters by current `variations` ids) and re-runnable.
  const deleteVariation = useCallback(
    async (variationId: string) => {
      const newVariations = experiment.variations.filter(
        (v) => v.id !== variationId,
      );
      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({
          variations: newVariations,
          variationWeights: getEqualWeights(newVariations.length, 4),
        }),
      });
      await Promise.all(
        visualChangesets
          .filter((vc) =>
            vc.visualChanges.some((c) => c.variation === variationId),
          )
          .map((vc) =>
            apiCall(`/visual-changesets/${vc.id}`, {
              method: "PUT",
              body: JSON.stringify({
                ...vc,
                visualChanges: vc.visualChanges.filter(
                  (c) => c.variation !== variationId,
                ),
              }),
            }),
          ),
      );
    },
    [apiCall, experiment, visualChangesets],
  );
  const changesetOwner = useMemo(
    () => experimentVisualChangesetOwner(experiment, deleteVariation),
    [experiment, deleteVariation],
  );
  const canAddLinkedChanges =
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate &&
    !experiment.archived;
  const linkedChangeTarget: LinkedChangeTarget = {
    project: experiment.project ?? "",
    noun: "experiment",
    types: ["feature-flag", "visual-editor", "redirects"],
  };

  const publicLinkedChangeSummary: { id: LinkedChange; count: number }[] = [
    { id: "feature-flag", count: linkedFeatures.length },
    { id: "visual-editor", count: visualChangesets.length },
    { id: "redirects", count: urlRedirects.length },
  ];

  return (
    <Frame>
      <Flex justify="between" align="center" mb="4" gap="3">
        <Heading color="text-high" as="h4" size="sm">
          {isPublic || hideVariations
            ? "Linked Changes"
            : "Variations & Values"}
        </Heading>
        {!isPublic && onAddVariation && !hideVariations ? (
          <Button variant="ghost" onClick={onAddVariation}>
            Edit Variations
          </Button>
        ) : null}
      </Flex>
      {isPublic ? (
        <Flex direction="column" gap="3" mx="1" mb="2" mt="4">
          {publicLinkedChangeSummary
            .filter(({ count }) => count > 0)
            .map(({ id, count }) => {
              const { component: Icon, radixColor } = ICON_PROPERTIES[id];
              const label = LINKED_CHANGE_CONTAINER_PROPERTIES[id].header;
              return (
                <Flex key={id} gap="3" align="center">
                  <Avatar
                    radius="full"
                    color={radixColor as AvatarProps["color"]}
                    size="lg"
                    variant="soft"
                  >
                    <Icon />
                  </Avatar>
                  <Text size="lg" weight="medium" color="text-high">
                    {label}:
                  </Text>
                  <Text size="lg" weight="medium" color="text-mid">
                    {count}
                  </Text>
                </Flex>
              );
            })}
        </Flex>
      ) : (
        <>
          {!isPublic && !hideVariations ? (
            <>
              <Box>
                <VariationsTable
                  experiment={experiment}
                  canEditExperiment={canEditExperiment ?? false}
                  mutate={mutate}
                  noMargin
                  onEditMetadata={
                    canEditExperiment && setEditVariationIndex
                      ? (index) => setEditVariationIndex(index)
                      : undefined
                  }
                />
              </Box>
              {(numLinkedChanges !== 0 || experiment.status === "draft") && (
                <Separator size="4" my="6" />
              )}
            </>
          ) : null}
          {linkedFeatures.map((info) => (
            <LinkedFeatureFlag
              info={info}
              experiment={experiment}
              mutate={mutate}
              key={info.feature.id}
              numLinkedChanges={numLinkedChanges}
              onReAdd={
                setFeatureModal ? () => setFeatureModal(true) : undefined
              }
            />
          ))}
          <VisualChangesetTable
            owner={changesetOwner}
            visualChangesets={visualChangesets}
            mutate={mutate}
            canEditVisualChangesets={canEditVisualChangesets}
            environmentStates={visualChangesetEnvStates}
          />
          {urlRedirects.map((r) => (
            <RedirectLinkedChanges
              urlRedirect={r}
              experiment={experiment}
              mutate={mutate}
              canEdit={canAddChanges}
              key={r.id}
              environmentStates={urlRedirectEnvStates}
            />
          ))}
          {canAddLinkedChanges &&
            numLinkedChanges > 0 &&
            setFeatureModal &&
            setVisualEditorModal &&
            setUrlRedirectModal && (
              <Flex justify="between" px="1">
                <Text color="text-high" size="lg" weight="semibold">
                  Add Feature, URL Redirect or AI Visual Editor
                </Text>
                <AddLinkedChangeButton
                  target={linkedChangeTarget}
                  linkedFeatures={linkedFeatures}
                  visualChangesets={visualChangesets}
                  urlRedirects={urlRedirects}
                  onFeatureFlag={() => setFeatureModal(true)}
                  onVisualEditor={() => setVisualEditorModal(true)}
                  onUrlRedirect={() => setUrlRedirectModal(true)}
                />
              </Flex>
            )}
          {setFeatureModal && setVisualEditorModal && setUrlRedirectModal && (
            <AddLinkedChanges
              target={linkedChangeTarget}
              canAdd={canAddLinkedChanges}
              numLinkedChanges={numLinkedChanges}
              setFeatureModal={setFeatureModal}
              setVisualEditorModal={setVisualEditorModal}
              setUrlRedirectModal={setUrlRedirectModal}
            />
          )}
        </>
      )}
    </Frame>
  );
}
