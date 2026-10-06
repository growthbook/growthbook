import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import LinkedFeatureFlag from "@/components/Experiment/LinkedChanges/LinkedFeatureFlag";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import Avatar from "@/ui/Avatar";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import VariationsTable from "@/components/Experiment/VariationsTable";
import Button from "@/ui/Button";
import { DeliveryMethod } from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import { EXPERIMENT_TYPE_MENU_ITEMS } from "@/components/Experiment/TabbedPage/ManagedValuesDelivery";
import { LINKED_CHANGE_TYPE_LABELS } from "@/components/Experiment/TabbedPage/linkedChangesSummary";
import { RedirectLinkedChanges } from "./RedirectLinkedChanges";
import AddLinkedChangeButton from "./AddLinkedChangeButton";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  type LinkedChange,
} from "./constants";
import AddLinkedChanges from "./AddLinkedChanges";

// --- Per-type rendering (prototype) ----------------------------------------
//
// Ported from prototype/managed-values-simplified, where it's driven by the
// prototype's delivery-type context. Here it's an optional `deliveryType`
// prop instead, so callers that don't pass it (bandits, the old layout)
// render exactly as before and never need the prototype's provider.

type ReferenceType = Exclude<DeliveryMethod, "values">;

const ADD_BUTTON_LABEL: Record<ReferenceType, string> = {
  "feature-flag": "Add Feature Flag",
  "visual-editor": "Add Visual Editor Changes",
  "url-redirect": "Add URL Redirect",
};

// No title: the section heading above already names the type.
const EMPTY_STATE_COPY: Record<
  ReferenceType,
  { description: string; buttonLabel: string }
> = {
  "feature-flag": {
    description:
      "Use feature flags and SDKs to make changes in your front-end, back-end or mobile application code.",
    buttonLabel: "Link Feature Flag",
  },
  "visual-editor": {
    description:
      "Use our no-code browser extension to A/B test minor changes, such as headings or button text.",
    buttonLabel: "Launch Visual Editor",
  },
  "url-redirect": {
    description:
      "Use our no-code tool to A/B test URL redirects for whole pages, or to test parts of a URL.",
    buttonLabel: "Add URL Redirect",
  },
};

// Local, not shared. Reuses the Change Experiment Type modal's icons and
// tint colours (EXPERIMENT_TYPE_MENU_ITEMS), circular and larger.
function LinkedChangesEmptyState({
  deliveryType,
  onAdd,
}: {
  deliveryType: ReferenceType;
  onAdd?: () => void;
}) {
  const item = EXPERIMENT_TYPE_MENU_ITEMS.find(
    (i) => i.method === deliveryType,
  );
  const { description, buttonLabel } = EMPTY_STATE_COPY[deliveryType];
  return (
    <Flex
      direction="column"
      align="center"
      width="100%"
      pt="3"
      pb="8"
      mx="auto"
      style={{ maxWidth: 440 }}
    >
      {item ? (
        <Avatar color={item.iconColor} variant="soft" size="lg">
          {item.icon}
        </Avatar>
      ) : null}
      <Text size="md" color="text-mid" align="center" mt="4">
        {description}
      </Text>
      {onAdd ? (
        <Button mt="5" onClick={onAdd}>
          {buttonLabel}
        </Button>
      ) : null}
    </Flex>
  );
}

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
  deliveryType,
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
  // Prototype. When set to a reference type, only that type's linked changes
  // render, with a per-type empty state and add button. Records of other
  // types still exist; they just aren't shown while the experiment isn't on
  // that type (ChangeExperimentTypeModal warns about this). Only honoured on
  // the detail-page path (hideVariations, not public). Never "values": a
  // Values experiment has no linked changes and the caller doesn't render
  // this section.
  deliveryType?: ReferenceType;
}) {
  const numLinkedChanges =
    linkedFeatures.length + visualChangesets.length + urlRedirects.length;

  const publicLinkedChangeSummary: { id: LinkedChange; count: number }[] = [
    { id: "feature-flag", count: linkedFeatures.length },
    { id: "visual-editor", count: visualChangesets.length },
    { id: "redirects", count: urlRedirects.length },
  ];

  const typedDetail =
    !!deliveryType && !isPublic && !!hideVariations ? deliveryType : null;
  const typedCount = !typedDetail
    ? 0
    : typedDetail === "feature-flag"
      ? linkedFeatures.length
      : typedDetail === "visual-editor"
        ? visualChangesets.length
        : urlRedirects.length;
  const addForType = !typedDetail
    ? undefined
    : typedDetail === "feature-flag"
      ? setFeatureModal
      : typedDetail === "visual-editor"
        ? setVisualEditorModal
        : setUrlRedirectModal;
  const canAddForType = canAddChanges && !!addForType;

  return (
    // The anchor ChangeExperimentTypeModal scrolls to after a type change.
    <Frame id={typedDetail ? "linked-feature-flags" : undefined}>
      <Flex justify="between" align="center" mb="4" gap="3">
        <Heading color="text-high" as="h4" size="sm">
          {typedDetail
            ? LINKED_CHANGE_TYPE_LABELS[typedDetail]
            : isPublic || hideVariations
              ? "Linked Changes"
              : "Variations & Values"}
        </Heading>
        {!isPublic && onAddVariation && !hideVariations ? (
          <Button variant="ghost" onClick={onAddVariation}>
            Edit Variations
          </Button>
        ) : null}
      </Flex>
      {typedDetail ? (
        <>
          {typedDetail === "feature-flag" &&
            linkedFeatures.map((info) => (
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
          {typedDetail === "visual-editor" ? (
            <VisualChangesetTable
              experiment={experiment}
              visualChangesets={visualChangesets}
              mutate={mutate}
              canEditVisualChangesets={canEditVisualChangesets}
              environmentStates={visualChangesetEnvStates}
            />
          ) : null}
          {typedDetail === "url-redirect" &&
            urlRedirects.map((r) => (
              <RedirectLinkedChanges
                urlRedirect={r}
                experiment={experiment}
                mutate={mutate}
                canEdit={canAddChanges}
                key={r.id}
                environmentStates={urlRedirectEnvStates}
              />
            ))}
          {typedCount === 0 ? (
            <LinkedChangesEmptyState
              deliveryType={typedDetail}
              onAdd={canAddForType ? () => addForType(true) : undefined}
            />
          ) : canAddForType ? (
            <Flex justify="end" mt="3">
              <Button icon={<PiPlus />} onClick={() => addForType(true)}>
                {ADD_BUTTON_LABEL[typedDetail]}
              </Button>
            </Flex>
          ) : null}
        </>
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
                <Text color="text-high" size="lg" weight="semibold">
                  Add Feature, URL Redirect or AI Visual Editor
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
