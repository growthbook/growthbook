import { ReactNode } from "react";
import { Box, Flex, type AvatarProps } from "@radix-ui/themes";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  i18n: I18n,
): CheckListItem | null {
  if (visualChangesetsError) {
    const errorMessage = visualChangesetsError.message;
    return blockingRow({
      key: "visual-changes-error",
      display: i18n._(
        msg`Couldn't load this Contextual Bandit's visual changes (${errorMessage}). Reload the page and try again.`,
      ),
    });
  }
  if (visualChangesetsLoading) {
    return blockingRow({
      key: "visual-changes-loading",
      display: i18n._(msg`Checking for saved AI Visual Editor changes…`),
    });
  }
  if (
    linkedFeatures.length === 0 &&
    !contextualBanditHasServableVisualChanges(cb, visualChangesets)
  ) {
    return blockingRow({
      key: "no-linked-change",
      display: i18n._(
        msg`Link at least one Feature Flag or save an AI Visual Editor change`,
      ),
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
  i18n: I18n,
): CheckListItem[] {
  const noLinkedChange = linkedChangeRow(
    cb,
    linkedFeatures,
    visualChangesets,
    visualChangesetsLoading,
    visualChangesetsError,
    i18n,
  );
  const awaitingApproval = linkedFeatures
    .filter(
      (f) =>
        f.pendingApproval &&
        !f.hasUnrelatedDraftChanges &&
        !linkedDraftApproved(f),
    )
    .map((f) => {
      const featureId = f.feature.id;
      return blockingRow({
        key: `approve-${f.feature.id}`,
        display: i18n._(msg`Approve the Feature Flag draft for ${featureId}`),
        action: linkedFeatureAction(f),
        description: f.draftRevisionStatus ? (
          <Badge
            label={revisionStatusLabel(f.draftRevisionStatus, i18n)}
            color={revisionStatusColor(f.draftRevisionStatus)}
            radius="full"
          />
        ) : undefined,
      });
    });
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
  title,
  children,
}: {
  type: LinkedChange;
  title: ReactNode;
  children: ReactNode;
}) {
  const { component: Icon, radixColor } = ICON_PROPERTIES[type];
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
          {title}
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
  const { t, i18n } = useLingui();
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
      i18n,
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
          <Modal.Title>
            <Trans>Start Contextual Bandit</Trans>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {summary.remaining > 0 && (
            <StartModalSection
              title={t`To Do`}
              icon={
                hasHardBlockers ? (
                  <PiWarningOctagonFill
                    color="var(--red-11)"
                    size={15}
                    aria-label={t`error`}
                  />
                ) : (
                  <PiWarningFill
                    color="var(--amber-11)"
                    size={15}
                    aria-label={t`warning`}
                  />
                )
              }
              mb="3"
            >
              <ChecklistItems summary={summary} size="md" />
            </StartModalSection>
          )}
          <StartModalSection
            title={t`Summary`}
            icon={<PiInfoFill color="var(--indigo-11)" size={15} />}
          >
            <Flex direction="column" gap="4">
              <TargetingSummaryRow label={t`Traffic`} inline>
                <Text>
                  <Trans>{coveragePct} included</Trans>
                </Text>
              </TargetingSummaryRow>
              {hasAttributeTargeting && (
                <TargetingSummaryRow label={t`Attribute targeting`}>
                  <ConditionDisplay condition={cb.condition ?? "{}"} />
                </TargetingSummaryRow>
              )}
              {hasSavedGroupTargeting && (
                <TargetingSummaryRow label={t`Saved Group targeting`}>
                  <SavedGroupTargetingDisplay
                    savedGroups={cb.savedGroups ?? []}
                  />
                </TargetingSummaryRow>
              )}
              {hasPrerequisites && (
                <TargetingSummaryRow label={t`Prerequisites`}>
                  <ConditionDisplay prerequisites={cb.prerequisites} />
                </TargetingSummaryRow>
              )}
            </Flex>
          </StartModalSection>
          {(hasLinkedFeatures || visualChangesets.length > 0) && (
            <StartModalSection mt="3">
              <Text weight="semibold" color="text-high">
                <Trans>
                  Linked changes will activate. Users will see Bandit variations
                  immediately.
                </Trans>
              </Text>
              <Flex direction="column" gap="4" mt="3">
                {hasLinkedFeatures && (
                  <LinkedChangeSection
                    type="feature-flag"
                    title={
                      <Plural
                        value={linkedFeatures.length}
                        one="# Linked Feature"
                        other="# Linked Features"
                      />
                    }
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
                    title={
                      <Plural
                        value={visualChangesets.length}
                        one="# Page with AI Visual Editor Change"
                        other="# Pages with AI Visual Editor Changes"
                      />
                    }
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
              <Trans>Cancel</Trans>
            </Button>
          </Modal.Close>
          <SubmitButton cta={t`Start Now`} disabled={hasHardBlockers} />
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}
