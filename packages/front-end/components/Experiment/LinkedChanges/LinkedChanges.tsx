import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import LinkedFeatureFlag from "@/components/Experiment/LinkedChanges/LinkedFeatureFlag";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
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
import AddLinkedChanges from "./AddLinkedChanges";

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
  const numLinkedChanges =
    linkedFeatures.length + visualChangesets.length + urlRedirects.length;

  const publicLinkedChangeSummary: { id: LinkedChange; count: number }[] = [
    { id: "feature-flag", count: linkedFeatures.length },
    { id: "visual-editor", count: visualChangesets.length },
    { id: "redirects", count: urlRedirects.length },
  ];

  return (
    <Frame>
      <Flex justify="between" align="center" mb="4" gap="3">
        <Heading color="text-high" as="h4" size="small">
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
                  <Text size="large" weight="medium" color="text-high">
                    {label}:
                  </Text>
                  <Text size="large" weight="medium" color="text-mid">
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
            experiment={experiment}
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
          {experiment.status === "draft" &&
            !experiment.nextScheduledStatusUpdate &&
            !experiment.archived &&
            numLinkedChanges > 0 &&
            setFeatureModal &&
            setVisualEditorModal &&
            setUrlRedirectModal && (
              <Flex justify="between" px="1">
                <Text color="text-high" size="large" weight="semibold">
                  Add Feature, URL Redirect or Visual Editor
                </Text>
                <AddLinkedChangeButton
                  experiment={experiment}
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
              experiment={experiment}
              numLinkedChanges={numLinkedChanges}
              hasLinkedFeatures={linkedFeatures.length > 0}
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
