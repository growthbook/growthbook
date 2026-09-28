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
import { ChecklistItems } from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import type {
  ChecklistAction,
  CheckListItem,
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
  const items: CheckListItem[] = [];
  const featureLink = (
    f: LinkedFeatureInfo,
    draft = true,
  ): ChecklistAction => ({
    href: `/features/${f.feature.id}${draft && (f.draftRevisionVersion ?? null) !== null ? `?v=${f.draftRevisionVersion}` : ""}`,
    external: true,
  });
  const blocker = (
    item: Pick<CheckListItem, "key" | "display" | "action" | "description">,
  ): CheckListItem => ({
    ...item,
    status: "incomplete",
    type: "auto",
    required: true,
    hardBlock: true,
  });

  if (linkedFeatures.length === 0) {
    items.push(
      blocker({
        key: "no-linked-feature",
        display: "Link at least one Feature Flag",
      }),
    );
  }

  linkedFeatures
    .filter((f) => f.state === "draft" && f.hasMergeConflict)
    .forEach((f) => {
      items.push(
        blocker({
          key: `merge-${f.feature.id}`,
          display: `Resolve the merge conflict in ${f.feature.id}`,
          action: featureLink(f),
        }),
      );
    });

  linkedFeatures
    .filter(
      (f) =>
        f.pendingApproval &&
        !f.hasUnrelatedDraftChanges &&
        f.draftRevisionStatus !== "approved",
    )
    .forEach((f) => {
      items.push(
        blocker({
          key: `approve-${f.feature.id}`,
          display: `Approve the Feature Flag draft for ${f.feature.id}`,
          action: featureLink(f),
          description: f.draftRevisionStatus ? (
            <Badge
              label={revisionStatusLabel(f.draftRevisionStatus)}
              color={revisionStatusColor(f.draftRevisionStatus)}
              radius="full"
            />
          ) : undefined,
        }),
      );
    });

  linkedFeatures
    .filter(
      (f) =>
        f.state === "draft" &&
        f.hasUnrelatedDraftChanges &&
        !f.hasMergeConflict,
    )
    .forEach((f) => {
      items.push(
        blocker({
          key: `unrelated-${f.feature.id}`,
          display: `The ${f.feature.id} draft has changes unrelated to this Contextual Bandit`,
          action: featureLink(f),
        }),
      );
    });

  linkedFeatures
    .filter((f) => f.state !== "discarded" && f.state !== "archived")
    .forEach((f) => {
      const configuredVariationIds = new Set(
        f.values.map((v) => v.variationId),
      );
      const hasMissingValues = cb.variations.some(
        (v) => !configuredVariationIds.has(v.id),
      );
      if (hasMissingValues) {
        items.push({
          key: `values-${f.feature.id}`,
          status: "incomplete",
          type: "auto",
          required: true,
          display: `Fill in missing variation values for ${f.feature.id}`,
          action: featureLink(f, false),
        });
      }
    });

  return items;
}

function SubmitButton({ cta, disabled }: { cta: string; disabled: boolean }) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" disabled={disabled} loading={loading}>
      {cta}
    </Button>
  );
}

function SummaryRow({
  label,
  children,
  inline = false,
}: {
  label: string;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <Flex
      direction={inline ? "row" : "column"}
      gap={inline ? "2" : "1"}
      align={inline ? "baseline" : "stretch"}
    >
      <Text size="md" weight="semibold" color="text-high">
        {label}:
      </Text>
      <Box>{children}</Box>
    </Flex>
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
              <SummaryRow label="Traffic" inline>
                <Text>{coveragePct}% included</Text>
              </SummaryRow>
              {hasAttributeTargeting && (
                <SummaryRow label="Attribute Targeting">
                  <ConditionDisplay condition={cb.condition ?? "{}"} />
                </SummaryRow>
              )}
              {hasSavedGroupTargeting && (
                <SummaryRow label="Saved Group Targeting">
                  <SavedGroupTargetingDisplay
                    savedGroups={cb.savedGroups ?? []}
                  />
                </SummaryRow>
              )}
              {hasPrerequisites && (
                <SummaryRow label="Prerequisites">
                  <ConditionDisplay prerequisites={cb.prerequisites} />
                </SummaryRow>
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
