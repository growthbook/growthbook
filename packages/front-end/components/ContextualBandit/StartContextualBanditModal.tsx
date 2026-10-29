import { ReactNode } from "react";
import { Box, Flex, type AvatarProps } from "@radix-ui/themes";
import {
  PiInfoFill,
  PiArrowSquareOut,
  PiWarningFill,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { ApiContextualBanditInterface } from "shared/validators";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { linkedDraftApproved } from "shared/util";
import { contextualBanditHasServableVisualChanges } from "shared/experiments";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Avatar from "@/ui/Avatar";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  type LinkedChange,
} from "@/components/Experiment/LinkedChanges/constants";
import StartModalSection from "@/components/Experiment/StartModalSection";
import { TargetingSummaryRow } from "@/components/Experiment/TabbedPage/StartSections";
import { ChecklistItems } from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import {
  blockingRow,
  linkedFeatureAction,
  mergeConflictRows,
  missingVariationValueRows,
  unrelatedDraftChangeRows,
  type CheckListItem,
} from "@/components/PreLaunchChecklist/PreLaunchChecklistItems";
import { summarizeChecklist } from "@/components/PreLaunchChecklist/checklistSummary";
import { coveragePercentFormatter } from "@/services/utils";

export interface Props {
  cb: ApiContextualBanditInterface;
  linkedFeatures?: LinkedFeatureInfo[];
  visualChangesets?: VisualChangesetInterface[];
  visualChangesetsLoading?: boolean;
  visualChangesetsError?: Error;
  startContextualBandit: () => Promise<void>;
  close: () => void;
}

function linkedChangeRow(
  cb: ApiContextualBanditInterface,
  linkedFeatures: LinkedFeatureInfo[],
  visualChangesets: VisualChangesetInterface[],
  visualChangesetsLoading: boolean,
  visualChangesetsError: Error | undefined,
): CheckListItem | null {
  if (visualChangesetsError) {
    return blockingRow({
      key: "visual-changes-error",
      display: `Couldn't load this Contextual Bandit's visual changes (${visualChangesetsError.message}). Reload the page and try again.`,
    });
  }
  if (visualChangesetsLoading) {
    return blockingRow({
      key: "visual-changes-loading",
      display: "Checking for saved AI Visual Editor changes…",
    });
  }
  if (
    linkedFeatures.length === 0 &&
    !contextualBanditHasServableVisualChanges(cb, visualChangesets)
  ) {
    return blockingRow({
      key: "no-linked-change",
      display:
        "Link at least one Feature Flag or save an AI Visual Editor change",
    });
  }
  return null;
}

function getChecklistItems(
  cb: ApiContextualBanditInterface,
  linkedFeatures: LinkedFeatureInfo[],
  visualChangesets: VisualChangesetInterface[],
  visualChangesetsLoading: boolean,
  visualChangesetsError: Error | undefined,
): CheckListItem[] {
  const noLinkedChange = linkedChangeRow(
    cb,
    linkedFeatures,
    visualChangesets,
    visualChangesetsLoading,
    visualChangesetsError,
  );
  const awaitingApproval = linkedFeatures
    .filter(
      (f) =>
        f.pendingApproval &&
        !f.hasUnrelatedDraftChanges &&
        !linkedDraftApproved(f),
    )
    .map((f) =>
      blockingRow({
        key: `approve-${f.feature.id}`,
        display: `Approve the Feature Flag draft for ${f.feature.id}`,
        action: linkedFeatureAction(f),
        description: f.draftRevisionStatus ? (
          <Badge
            label={revisionStatusLabel(f.draftRevisionStatus)}
            color={revisionStatusColor(f.draftRevisionStatus)}
            radius="full"
          />
        ) : undefined,
      }),
    );
  return [
    ...(noLinkedChange ? [noLinkedChange] : []),
    ...mergeConflictRows(linkedFeatures),
    ...awaitingApproval,
    ...unrelatedDraftChangeRows(linkedFeatures),
    ...missingVariationValueRows(linkedFeatures, cb.variations),
  ];
}

function SubmitButton({ cta, disabled }: { cta: string; disabled: boolean }) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" disabled={disabled} loading={loading}>
      {cta}
    </Button>
  );
}

function LinkedChangeSection({
  type,
  count,
  countLabel,
  children,
}: {
  type: LinkedChange;
  count: number;
  countLabel?: string;
  children: ReactNode;
}) {
  const { component: Icon, radixColor } = ICON_PROPERTIES[type];
  const header = LINKED_CHANGE_CONTAINER_PROPERTIES[type].header;
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <Avatar
          radius="small"
          color={radixColor as AvatarProps["color"]}
          size="md"
          variant="soft"
        >
          <Icon />
        </Avatar>
        <Text weight="semibold" color="text-high">
          {countLabel ?? count} {count > 1 ? header : header.slice(0, -1)}
        </Text>
      </Flex>
      <Box pl="7">{children}</Box>
    </Flex>
  );
}

export default function StartContextualBanditModal({
  cb,
  linkedFeatures = [],
  visualChangesets = [],
  visualChangesetsLoading = false,
  visualChangesetsError,
  startContextualBandit,
  close,
}: Props) {
  const coveragePct = coveragePercentFormatter.format(cb.coverage ?? 1);
  const hasAttributeTargeting = !!(cb.condition && cb.condition !== "{}");
  const hasSavedGroupTargeting = !!cb.savedGroups?.length;
  const hasPrerequisites = !!cb.prerequisites?.length;
  const hasLinkedFeatures = linkedFeatures.length > 0;

  const summary = summarizeChecklist(
    getChecklistItems(
      cb,
      linkedFeatures,
      visualChangesets,
      visualChangesetsLoading,
      visualChangesetsError,
    ),
  );
  const hasHardBlockers = summary.blocking > 0;

  return (
    <Modal.Root
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size="lg"
      trackingEventModalType="start-contextual-bandit"
      trackingEventModalSource="contextual-bandit-detail"
    >
      <ModalForm
        onSubmit={async () => {
          await startContextualBandit();
          close();
        }}
      >
        <Modal.Header>
          <Modal.Title>Start Contextual Bandit</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {summary.remaining > 0 && (
            <StartModalSection
              title="To Do"
              icon={
                hasHardBlockers ? (
                  <PiWarningOctagonFill
                    color="var(--red-11)"
                    size={15}
                    aria-label="error"
                  />
                ) : (
                  <PiWarningFill
                    color="var(--amber-11)"
                    size={15}
                    aria-label="warning"
                  />
                )
              }
              mb="3"
            >
              <ChecklistItems summary={summary} size="md" />
            </StartModalSection>
          )}
          <StartModalSection
            title="Summary"
            icon={<PiInfoFill color="var(--indigo-11)" size={15} />}
          >
            <Flex direction="column" gap="4">
              <TargetingSummaryRow label="Traffic" inline>
                <Text>{coveragePct} included</Text>
              </TargetingSummaryRow>
              {hasAttributeTargeting && (
                <TargetingSummaryRow label="Attribute targeting">
                  <ConditionDisplay condition={cb.condition ?? "{}"} />
                </TargetingSummaryRow>
              )}
              {hasSavedGroupTargeting && (
                <TargetingSummaryRow label="Saved Group targeting">
                  <SavedGroupTargetingDisplay
                    savedGroups={cb.savedGroups ?? []}
                  />
                </TargetingSummaryRow>
              )}
              {hasPrerequisites && (
                <TargetingSummaryRow label="Prerequisites">
                  <ConditionDisplay prerequisites={cb.prerequisites} />
                </TargetingSummaryRow>
              )}
            </Flex>
          </StartModalSection>
          {(hasLinkedFeatures || visualChangesets.length > 0) && (
            <StartModalSection mt="3">
              <Text weight="semibold" color="text-high">
                Linked changes will activate. Users will see Bandit variations
                immediately.
              </Text>
              <Flex direction="column" gap="4" mt="3">
                {hasLinkedFeatures && (
                  <LinkedChangeSection
                    type="feature-flag"
                    count={linkedFeatures.length}
                  >
                    <Flex wrap="wrap" gap="3">
                      {linkedFeatures.map((info) =>
                        info.feature?.id ? (
                          <Link
                            key={info.feature.id}
                            href={`/features/${info.feature.id}`}
                            target="_blank"
                          >
                            <Text weight="semibold">{info.feature.id}</Text>
                            <PiArrowSquareOut className="ml-1" />
                          </Link>
                        ) : null,
                      )}
                    </Flex>
                  </LinkedChangeSection>
                )}
                {visualChangesets.length > 0 && (
                  <LinkedChangeSection
                    type="visual-editor"
                    count={visualChangesets.length}
                    countLabel={`${visualChangesets.length} Page${
                      visualChangesets.length === 1 ? "" : "s"
                    } with`}
                  >
                    <Flex wrap="wrap" gap="3">
                      {visualChangesets.map((vc) =>
                        vc.editorUrl ? (
                          <Link key={vc.id} href={vc.editorUrl} target="_blank">
                            <Text weight="semibold">{vc.editorUrl}</Text>
                            <PiArrowSquareOut className="ml-1" />
                          </Link>
                        ) : null,
                      )}
                    </Flex>
                  </LinkedChangeSection>
                )}
              </Flex>
            </StartModalSection>
          )}
        </Modal.Body>
        <Modal.Footer justify="between">
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </Modal.Close>
          <SubmitButton cta="Start Now" disabled={hasHardBlockers} />
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}
