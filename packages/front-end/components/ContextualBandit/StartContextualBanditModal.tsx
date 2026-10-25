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

export interface Props {
  cb: ApiContextualBanditInterface;
  linkedFeatures?: LinkedFeatureInfo[];
  startContextualBandit: () => Promise<void>;
  close: () => void;
}

function getChecklistItems(
  cb: ApiContextualBanditInterface,
  linkedFeatures: LinkedFeatureInfo[],
): CheckListItem[] {
  const noLinkedFeature =
    linkedFeatures.length === 0
      ? [
          blockingRow({
            key: "no-linked-feature",
            display: "Link at least one Feature Flag",
          }),
        ]
      : [];
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
    ...noLinkedFeature,
    ...mergeConflictRows(linkedFeatures),
    ...awaitingApproval,
    ...unrelatedDraftChangeRows(linkedFeatures, "Contextual Bandit"),
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
  children,
}: {
  type: LinkedChange;
  count: number;
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
          {count} {count > 1 ? header : header.slice(0, -1)}
        </Text>
      </Flex>
      <Box pl="7">{children}</Box>
    </Flex>
  );
}

export default function StartContextualBanditModal({
  cb,
  linkedFeatures = [],
  startContextualBandit,
  close,
}: Props) {
  const coveragePct = cb.coverage != null ? Math.floor(cb.coverage * 100) : 100;
  const hasAttributeTargeting = !!(cb.condition && cb.condition !== "{}");
  const hasSavedGroupTargeting = !!cb.savedGroups?.length;
  const hasPrerequisites = !!cb.prerequisites?.length;
  const hasLinkedFeatures = linkedFeatures.length > 0;

  const summary = summarizeChecklist(getChecklistItems(cb, linkedFeatures));
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
                <Text>{coveragePct}% included</Text>
              </TargetingSummaryRow>
              {hasAttributeTargeting && (
                <TargetingSummaryRow label="Attribute Targeting">
                  <ConditionDisplay condition={cb.condition ?? "{}"} />
                </TargetingSummaryRow>
              )}
              {hasSavedGroupTargeting && (
                <TargetingSummaryRow label="Saved Group Targeting">
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
          {hasLinkedFeatures && (
            <StartModalSection mt="3">
              <Text weight="semibold" color="text-high">
                Linked changes will activate. Users will see bandit variations
                immediately.
              </Text>
              <Flex direction="column" gap="4" mt="3">
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
