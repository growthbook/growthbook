import { useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { getImplementationType, isManagedByExperiment } from "shared/util";
import { PiInfo } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { ManagedFlagName } from "@/components/Experiment/ManagedFlagSummary";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import ChangeImplementationTypeModal from "@/components/Experiment/ChangeImplementationTypeModal";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";
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
  onAddValues,
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
  /** Creates the managed flag for a "values" experiment that has none yet. */
  onAddValues?: () => void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
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

  // "values" owns the box: it names the managed flag (or offers to create it)
  // and carries the eject action.
  const effectiveType = managedFeature
    ? "values"
    : getImplementationType(experiment);
  const valuesMode = effectiveType === "values";
  // Named for its kind; "Linked Changes" is reserved for legacy mixes.
  const boxTitle = valuesMode
    ? "Managed Feature Flag"
    : !(isPublic || hideVariations)
      ? "Variations & Values"
      : effectiveType === "multi"
        ? "Linked Changes"
        : effectiveType && effectiveType !== "none"
          ? IMPLEMENTATION_TYPE_OPTIONS[effectiveType].header
          : "Implementation";
  const canEject =
    !!managedFeature &&
    !!canEditExperiment &&
    permissionsUtil.canPublishFeature(
      managedFeature.feature,
      getEnabledEnvironments(managedFeature.feature, allEnvironments),
    );
  const [ejectConfirm, setEjectConfirm] = useState(false);
  const eject = async () => {
    await apiCall(`/experiment/${experiment.id}/managed-flag/eject`, {
      method: "POST",
    });
    setEjectConfirm(false);
    mutate?.();
  };

  const publicLinkedChangeSummary: { id: LinkedChange; count: number }[] = [
    { id: "feature-flag", count: linkedFeatures.length },
    { id: "visual-editor", count: visualChangesets.length },
    { id: "redirects", count: urlRedirects.length },
  ];

  return (
    <Frame>
      <Flex justify="between" align="center" mb="4" gap="3">
        <Flex align="center" gap="1">
          <Heading color="text-high" as="h4" size="sm" mb="0">
            {boxTitle}
          </Heading>
          {valuesMode && (
            <Tooltip body="This experiment owns the Feature Flag: it serves the variation values above and is edited from here rather than from its own page.">
              <Flex align="center" style={{ color: "var(--color-text-low)" }}>
                <PiInfo />
              </Flex>
            </Tooltip>
          )}
        </Flex>
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
              <DropdownMenuItem
                disabled={!!changeTypeLockedReason}
                tooltip={changeTypeLockedReason ?? undefined}
                onClick={() => setChangingType(true)}
              >
                Change experiment type
              </DropdownMenuItem>
              {canEject && (
                <DropdownMenuItem onClick={() => setEjectConfirm(true)}>
                  Convert to unmanaged Feature Flag
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          )}
        </Flex>
      </Flex>
      {ejectConfirm && (
        <ConfirmDialog
          title="Convert to unmanaged Feature Flag?"
          content="This experiment keeps using the linked Feature Flag, but you'll manage and review it directly from its own page instead of from here."
          yesText="Convert"
          onConfirm={eject}
          onCancel={() => setEjectConfirm(false)}
        />
      )}
      {changingType && mutate && (
        <ChangeImplementationTypeModal
          experiment={experiment}
          managedFeature={managedFeature}
          close={() => setChangingType(false)}
          mutate={mutate}
        />
      )}
      {valuesMode && !isPublic ? (
        managedFeature ? (
          <ManagedFlagName featureId={managedFeature.feature.id} />
        ) : (
          <Flex justify="between" align="center" gap="4">
            <Text color="text-mid">
              No Feature Flag yet. Adding variation values creates one.
            </Text>
            {onAddValues && (
              <Button variant="ghost" onClick={onAddValues}>
                Add values
              </Button>
            )}
          </Flex>
        )
      ) : isPublic ? (
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
                  allowOtherKinds={!effectiveType || effectiveType === "multi"}
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
