import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { getImplementationType, isManagedByExperiment } from "shared/util";
import { Flex, type AvatarProps } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";
import Tooltip from "@/ui/Tooltip";
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
  onChooseType,
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
  /** Opens the page's implementation type chooser; absent when it's locked. */
  onChooseType?: () => void;
}) {
  const numLinkedChanges =
    linkedFeatures.length + visualChangesets.length + urlRedirects.length;

  const managedFeature =
    linkedFeatures.find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;

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
              content="This experiment owns this Feature Flag and serves its variation values through it."
              side="top"
            >
              <Flex align="center" style={{ color: "var(--color-text-low)" }}>
                <PiInfo />
              </Flex>
            </Tooltip>
          )}
        </Flex>
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
          {effectiveType !== "feature" &&
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
          {setFeatureModal && setVisualEditorModal && setUrlRedirectModal && (
            <AddLinkedChanges
              experiment={experiment}
              numLinkedChanges={numLinkedChanges}
              hasLinkedFeatures={linkedFeatures.length > 0}
              setFeatureModal={setFeatureModal}
              setVisualEditorModal={setVisualEditorModal}
              setUrlRedirectModal={setUrlRedirectModal}
              onChooseType={onChooseType}
              canAddChanges={canAddChanges}
            />
          )}
        </>
      )}
    </Frame>
  );
}
