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

export interface Props {
  cb: ApiContextualBanditInterface;
  linkedFeatures?: LinkedFeatureInfo[];
  startContextualBandit: () => Promise<void>;
  close: () => void;
}

type BlockerItem = {
  key: string;
  display: ReactNode;
  hardBlock: boolean;
};

function computeBlockers(
  cb: ApiContextualBanditInterface,
  linkedFeatures: LinkedFeatureInfo[],
): { hardBlockerItems: BlockerItem[]; softBlockerItems: BlockerItem[] } {
  const hardBlockerItems: BlockerItem[] = [];
  const softBlockerItems: BlockerItem[] = [];

  const featureLink = (f: LinkedFeatureInfo) => (
    <Link
      href={`/features/${f.feature.id}${
        f.draftRevisionVersion != null ? `?v=${f.draftRevisionVersion}` : ""
      }`}
      target="_blank"
    >
      {f.feature.id}
      <PiArrowSquareOut className="ml-1" />
    </Link>
  );

  linkedFeatures
    .filter((f) => f.state === "draft" && f.hasMergeConflict)
    .forEach((f) => {
      hardBlockerItems.push({
        key: `merge-${f.feature.id}`,
        hardBlock: true,
        display: (
          <>
            Resolve merge conflict in {featureLink(f)} before this contextual
            bandit can start
          </>
        ),
      });
    });

  linkedFeatures
    .filter(
      (f) =>
        f.pendingApproval &&
        !f.hasUnrelatedDraftChanges &&
        f.draftRevisionStatus !== "approved",
    )
    .forEach((f) => {
      hardBlockerItems.push({
        key: `approve-${f.feature.id}`,
        hardBlock: true,
        display: (
          <>
            Approve the feature draft revision in {featureLink(f)}{" "}
            {f.draftRevisionStatus && (
              <Badge
                label={revisionStatusLabel(f.draftRevisionStatus)}
                color={revisionStatusColor(f.draftRevisionStatus)}
                radius="full"
                ml="1"
              />
            )}
          </>
        ),
      });
    });

  linkedFeatures
    .filter(
      (f) =>
        f.state === "draft" &&
        f.hasUnrelatedDraftChanges &&
        !f.hasMergeConflict,
    )
    .forEach((f) => {
      hardBlockerItems.push({
        key: `unrelated-${f.feature.id}`,
        hardBlock: true,
        display: (
          <>
            The feature draft revision in {featureLink(f)} contains additional
            changes unrelated to this contextual bandit.
          </>
        ),
      });
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
        softBlockerItems.push({
          key: `values-${f.feature.id}`,
          hardBlock: false,
          display: (
            <>
              Fill in missing variation values for{" "}
              <Link href={`/features/${f.feature.id}`} target="_blank">
                {f.feature.id}
                <PiArrowSquareOut className="ml-1" />
              </Link>
            </>
          ),
        });
      }
    });

  return { hardBlockerItems, softBlockerItems };
}

function SubmitButton({ cta, disabled }: { cta: string; disabled: boolean }) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" disabled={disabled} loading={loading}>
      {cta}
    </Button>
  );
}

function BlockerList({ items }: { items: BlockerItem[] }) {
  return (
    <Flex direction="column" gap="2">
      {items.map((item) => (
        <Flex key={item.key} gap="2" align="baseline">
          <Text color="text-mid">•</Text>
          <Text as="div" weight="semibold" color="text-mid">
            {item.display}
          </Text>
        </Flex>
      ))}
    </Flex>
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
      <Text size="medium" weight="semibold" color="text-high">
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

  const { hardBlockerItems, softBlockerItems } = computeBlockers(
    cb,
    linkedFeatures,
  );
  const hasHardBlockers = hardBlockerItems.length > 0;
  const hasBlockers = hasHardBlockers || softBlockerItems.length > 0;

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
          {hasBlockers && (
            <Box mb="3">
              <Flex align="center" gap="1">
                {hasHardBlockers ? (
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
                )}
                <Text size="large" weight="semibold" color="text-high">
                  Tasks to Complete
                </Text>
              </Flex>
              <Box
                mt="3"
                style={{
                  backgroundColor: "var(--slate-2)",
                  padding: "20px",
                  borderRadius: "var(--radius-3)",
                }}
              >
                {hasHardBlockers ? (
                  <Flex direction="column" gap="4">
                    <Box>
                      <Text size="small" weight="semibold" color="text-high">
                        Must resolve before starting
                      </Text>
                      <Box mt="2">
                        <BlockerList items={hardBlockerItems} />
                      </Box>
                    </Box>
                    {softBlockerItems.length > 0 && (
                      <Box>
                        <Text size="small" weight="semibold" color="text-high">
                          Recommended
                        </Text>
                        <Box mt="2">
                          <BlockerList items={softBlockerItems} />
                        </Box>
                      </Box>
                    )}
                  </Flex>
                ) : (
                  <BlockerList items={softBlockerItems} />
                )}
              </Box>
            </Box>
          )}
          <Box>
            <Flex align="center" gap="1">
              <PiInfoFill color="var(--indigo-11)" size={15} />
              <Text size="large" weight="semibold" color="text-high">
                Summary
              </Text>
            </Flex>
            <Box
              mt="3"
              style={{
                backgroundColor: "var(--slate-2)",
                padding: "20px",
                borderRadius: "var(--radius-3)",
              }}
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
            </Box>
          </Box>
          {hasLinkedFeatures && (
            <Box
              mt="3"
              style={{
                backgroundColor: "var(--slate-2)",
                padding: "20px",
                borderRadius: "var(--radius-3)",
              }}
            >
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
            </Box>
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
