import { useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { getImplementationType, isManagedByExperiment } from "shared/util";
import { Flex, IconButton, type AvatarProps } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiInfo } from "react-icons/pi";
import ChangeImplementationTypeModal, {
  implementationTypeLockedReason,
} from "@/components/Experiment/ChangeImplementationTypeModal";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";
import Tooltip from "@/ui/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import ImplementationHeading from "@/components/Experiment/ImplementationHeading";
import Avatar from "@/ui/Avatar";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
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
  canEditExperiment,
  managedMode,
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
  canEditExperiment?: boolean;
  /** Withholds the add-a-change surfaces. */
  managedMode?: boolean;
}) {
  const numLinkedChanges =
    linkedFeatures.length + visualChangesets.length + urlRedirects.length;

  const [changingType, setChangingType] = useState(false);
  const managedFeature =
    linkedFeatures.find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;
  const changeTypeLockedReason = implementationTypeLockedReason(
    experiment,
    linkedFeatures,
  );

  const effectiveType = managedFeature
    ? "values"
    : getImplementationType(experiment);
  const valuesMode = effectiveType === "values";
  // Titled by kind; "Linked Changes" is reserved for legacy mixes.
  const boxTitle = valuesMode
    ? "Managed Feature Flag"
    : effectiveType === "multi"
      ? "Linked Changes"
      : effectiveType && effectiveType !== "none"
        ? IMPLEMENTATION_TYPE_OPTIONS[effectiveType].header
        : "Implementation";
  // The empty state below already offers the type chooser; the kebab is for
  // once the box has content or the choice is locked.
  const emptyStateOffersType =
    numLinkedChanges === 0 &&
    (!effectiveType || effectiveType === "none") &&
    !changeTypeLockedReason;
  const showTypeMenu =
    !isPublic &&
    canEditExperiment &&
    !experiment.archived &&
    !emptyStateOffersType;

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
            <Tooltip
              content="This experiment owns the Feature Flag: it serves the variation values above and is edited from here rather than from its own page."
              side="top"
            >
              <Flex align="center" style={{ color: "var(--color-text-low)" }}>
                <PiInfo />
              </Flex>
            </Tooltip>
          )}
        </Flex>
        <Flex align="center" gap="2">
          {showTypeMenu && (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  aria-label={`${boxTitle} actions`}
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
                Change implementation type
              </DropdownMenuItem>
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
          {urlRedirects.length > 0 ? (
            <ImplementationHeading>URL Redirects</ImplementationHeading>
          ) : null}
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
          {visualChangesets.length > 0 ? (
            <ImplementationHeading>Visual Editor Changes</ImplementationHeading>
          ) : null}
          <VisualChangesetTable
            experiment={experiment}
            visualChangesets={visualChangesets}
            mutate={mutate}
            canEditVisualChangesets={canEditVisualChangesets}
            environmentStates={visualChangesetEnvStates}
          />
          {/* The value rows offer adding another flag under the last one. */}
          {!managedMode &&
            effectiveType !== "feature" &&
            experiment.status === "draft" &&
            !experiment.nextScheduledStatusUpdate &&
            !experiment.archived &&
            numLinkedChanges > 0 &&
            setFeatureModal &&
            setVisualEditorModal &&
            setUrlRedirectModal && (
              <Flex justify="between" px="1">
                <Text color="text-high" size="lg" weight="semibold">
                  {!effectiveType || effectiveType === "multi"
                    ? "Add Feature, URL Redirect or Visual Editor"
                    : `Add ${IMPLEMENTATION_TYPE_OPTIONS[effectiveType].header}`}
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
