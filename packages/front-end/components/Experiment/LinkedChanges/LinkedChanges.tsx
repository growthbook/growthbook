import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { isManagedByExperiment } from "shared/util";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import ChangeImplementationTypeModal from "@/components/Experiment/ChangeImplementationTypeModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
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
  managedMode,
  valuesShownOnVariations,
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
  /** Withholds the add-a-change surfaces. */
  managedMode?: boolean;
  /** The variation cards above are already showing the flag's values. */
  valuesShownOnVariations?: boolean;
  hideVariations?: boolean;
}) {
  const numLinkedChanges =
    linkedFeatures.length + visualChangesets.length + urlRedirects.length;

  const [changingType, setChangingType] = useState(false);
  const managedFeature =
    linkedFeatures.find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;
  // The managed flag is handled inside the change flow; anything else has to
  // be removed from this card first.
  const otherLinkages = numLinkedChanges - (managedFeature ? 1 : 0);
  const changeTypeLockedReason =
    experiment.status !== "draft"
      ? "The type can't be changed after the experiment starts."
      : otherLinkages > 0
        ? "Remove the linked Feature Flags, Visual Editor changes and URL Redirects first."
        : null;
  const showTypeMenu = !isPublic && canEditExperiment && !experiment.archived;

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
        <Flex align="center" gap="2">
          {!isPublic && onAddVariation && !hideVariations ? (
            <Button variant="ghost" onClick={onAddVariation}>
              Edit Variations
            </Button>
          ) : null}
          {showTypeMenu && (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  aria-label="Linked changes actions"
                >
                  <BsThreeDotsVertical size={16} />
                </IconButton>
              }
              menuPlacement="end"
              variant="soft"
            >
              {changeTypeLockedReason ? (
                <Tooltip body={changeTypeLockedReason}>
                  <DropdownMenuItem disabled>
                    Change experiment type
                  </DropdownMenuItem>
                </Tooltip>
              ) : (
                <DropdownMenuItem onClick={() => setChangingType(true)}>
                  Change experiment type
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          )}
        </Flex>
      </Flex>
      {changingType && mutate && (
        <ChangeImplementationTypeModal
          experiment={experiment}
          managedFeature={managedFeature}
          close={() => setChangingType(false)}
          mutate={mutate}
        />
      )}
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
              valuesShownOnVariations={valuesShownOnVariations}
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
          {!managedMode &&
            experiment.status === "draft" &&
            !experiment.nextScheduledStatusUpdate &&
            !experiment.archived &&
            numLinkedChanges > 0 &&
            setFeatureModal &&
            setVisualEditorModal &&
            setUrlRedirectModal && (
              <Flex justify="between" px="1">
                <Text color="text-high" size="lg" weight="semibold">
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
          {!managedMode &&
            setFeatureModal &&
            setVisualEditorModal &&
            setUrlRedirectModal && (
              <AddLinkedChanges
                experiment={experiment}
                numLinkedChanges={numLinkedChanges}
                hasLinkedFeatures={linkedFeatures.length > 0}
                setFeatureModal={setFeatureModal}
                setVisualEditorModal={setVisualEditorModal}
                setUrlRedirectModal={setUrlRedirectModal}
                onChooseType={
                  changeTypeLockedReason
                    ? undefined
                    : () => setChangingType(true)
                }
              />
            )}
        </>
      )}
    </Frame>
  );
}
