import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { format } from "date-fns-tz";
import { ReactNode, useState } from "react";
import { Box, Flex, type AvatarProps } from "@radix-ui/themes";
import {
  PiInfoFill,
  PiArrowSquareOut,
  PiWarningFill,
  PiWarningOctagonFill,
} from "react-icons/pi";
import Modal, { useModalContext } from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumCallout from "@/ui/PremiumCallout";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Avatar from "@/ui/Avatar";
import { formatTrafficSplit } from "@/services/utils";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  type LinkedChange,
} from "@/components/Experiment/LinkedChanges/constants";
import { CheckListItem } from "@/components/Experiment/PreLaunchChecklist";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  startExperiment: () => Promise<void>;
  scheduleExperiment?: () => Promise<void>;
  checklistItemsRemaining: number;
  checklistHardBlockerCount?: number;
  isHoldout?: boolean;
  linkedFeatures?: LinkedFeatureInfo[];
  visualChangesets?: VisualChangesetInterface[];
  urlRedirects?: URLRedirectInterface[];
  incompleteChecklistItems?: CheckListItem[];
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

function SecondaryActionButton({
  label,
  action,
  close,
}: {
  label: string;
  action: () => Promise<void>;
  close: () => void;
}) {
  const { setError } = useModalContext();
  return (
    <Button
      variant="ghost"
      color="red"
      type="button"
      setError={setError}
      onClick={async () => {
        await action();
        close();
      }}
    >
      {label}
    </Button>
  );
}

export default function StartExperimentModal({
  experiment,
  close,
  startExperiment,
  scheduleExperiment,
  checklistItemsRemaining,
  checklistHardBlockerCount = 0,
  isHoldout,
  linkedFeatures = [],
  visualChangesets = [],
  urlRedirects = [],
  incompleteChecklistItems = [],
}: Props) {
  const checklistIncomplete = checklistItemsRemaining > 0;
  const phase = experiment.phases?.[experiment.phases.length - 1];
  const isBandit = experiment.type === "multi-armed-bandit";
  const hasAttributeTargeting = !!(
    phase?.condition && phase.condition !== "{}"
  );
  const hasSavedGroupTargeting = !!phase?.savedGroups?.length;
  const hasPrerequisites = !!phase?.prerequisites?.length && !isHoldout;
  const hasLinkedChanges =
    linkedFeatures.length > 0 ||
    visualChangesets.length > 0 ||
    urlRedirects.length > 0;
  const parsedScheduledDate = experiment.statusUpdateSchedule?.startAt
    ? new Date(experiment.statusUpdateSchedule.startAt)
    : null;
  const hasSchedule = !!parsedScheduledDate;
  const scheduledStartDateIsInThePast =
    !!parsedScheduledDate && parsedScheduledDate < new Date();
  const scheduledStartDateIsInTheFuture =
    !!parsedScheduledDate && parsedScheduledDate > new Date();
  // The schedule action only makes sense for a future-dated schedule.
  const useScheduledFlow =
    scheduledStartDateIsInTheFuture && !!scheduleExperiment;
  // Hard blockers (merge conflicts, missing approvals, unrelated draft edits)
  // can't be bypassed via "Start Anyway" — the auto-publish at start either
  // rejects them outright or would silently publish unreviewed changes.
  const hasHardBlockers = checklistHardBlockerCount > 0;
  const hardBlockerItems = incompleteChecklistItems.filter(
    (item) => item.hardBlock,
  );
  const softBlockerItems = incompleteChecklistItems.filter(
    (item) => !item.hardBlock,
  );
  // Only group when we actually have hard-blocker items in the rendered list,
  // not just a non-zero count from props, so we never render an empty section.
  const shouldGroupBlockers = hardBlockerItems.length > 0;

  const [upgradeModal, setUpgradeModal] = useState(false);

  const { hasCommercialFeature } = useUser();

  const needsVisualEditorUpgrade =
    experiment.hasVisualChangesets && !hasCommercialFeature("visual-editor");

  const needsRedirectUpgrade =
    experiment.hasURLRedirects && !hasCommercialFeature("redirects");

  const needsUpgrade = needsVisualEditorUpgrade || needsRedirectUpgrade;

  if (needsUpgrade && upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        commercialFeature={
          needsVisualEditorUpgrade ? "visual-editor" : "redirects"
        }
        source="start-experiment-modal"
      />
    );
  }

  const header =
    hasSchedule && !isHoldout
      ? "Schedule Experiment to Start"
      : isHoldout
        ? "Start Holdout"
        : "Start Experiment";

  const primaryCta =
    hasSchedule && parsedScheduledDate
      ? `Start ${format(parsedScheduledDate, "MMM d, yyyy 'at' h:mm a")}`
      : "Start Now";

  const subHeader =
    hasSchedule && parsedScheduledDate
      ? `Scheduled to start ${format(parsedScheduledDate, "MMM d, yyyy 'at' h:mm a (z)")}`
      : null;

  const primaryAction = useScheduledFlow
    ? scheduleExperiment!
    : startExperiment;
  const primaryDisabled =
    checklistIncomplete || !!needsUpgrade || scheduledStartDateIsInThePast;

  // Secondary action: a single button slot that surfaces the contextually
  // appropriate fallback. Hidden entirely when there's nothing to override
  // (no upgrade gate, no hard blockers).
  let secondaryLabel: string | null = null;
  let secondaryAction: (() => Promise<void>) | null = null;
  if (!needsUpgrade && !hasHardBlockers) {
    if (scheduledStartDateIsInThePast) {
      secondaryLabel = "Start Now";
      secondaryAction = startExperiment;
    } else if (
      scheduledStartDateIsInTheFuture &&
      checklistIncomplete &&
      scheduleExperiment
    ) {
      secondaryLabel = "Schedule Anyway";
      secondaryAction = scheduleExperiment;
    } else if (!hasSchedule && checklistIncomplete) {
      secondaryLabel = "Start Anyway";
      secondaryAction = startExperiment;
    }
  }

  return (
    <Modal.Root
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size="lg"
      trackingEventModalType="start-experiment"
      trackingEventModalSource={
        checklistIncomplete ? "incomplete-checklist" : "complete-checklist"
      }
    >
      <ModalForm
        onSubmit={async () => {
          await primaryAction();
          close();
        }}
      >
        <Modal.Header>
          <Modal.Title>{header}</Modal.Title>
        </Modal.Header>
        {subHeader && <Modal.Description>{subHeader}</Modal.Description>}
        <Modal.Body>
          {scheduledStartDateIsInThePast && parsedScheduledDate && (
            <Callout status="warning" mb="3">
              The scheduled start date{" "}
              <Text weight="semibold">
                {format(parsedScheduledDate, "MMM d, yyyy 'at' h:mm a (z)")}
              </Text>{" "}
              has passed. Click <Text weight="semibold">Start Now</Text> to
              start the experiment immediately, or close this modal and update
              the schedule.
            </Callout>
          )}

          {checklistIncomplete && (
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
              {incompleteChecklistItems.length > 0 && (
                <Box
                  mt="3"
                  style={{
                    backgroundColor: "var(--slate-2)",
                    padding: "20px",
                    borderRadius: "var(--radius-3)",
                  }}
                >
                  {shouldGroupBlockers ? (
                    <Flex direction="column" gap="4">
                      <Box>
                        <Text size="small" weight="semibold" color="text-high">
                          Must resolve before starting
                        </Text>
                        <Box mt="2">
                          <Flex direction="column" gap="2">
                            {hardBlockerItems.map((item, i) => (
                              <Flex
                                key={item.key ?? `hard-${i}`}
                                gap="2"
                                align="baseline"
                              >
                                <Text color="text-mid">•</Text>
                                <Text
                                  as="div"
                                  weight="semibold"
                                  color="text-mid"
                                >
                                  {item.display}
                                </Text>
                              </Flex>
                            ))}
                          </Flex>
                        </Box>
                      </Box>
                      {softBlockerItems.length > 0 && (
                        <Box>
                          <Text
                            size="small"
                            weight="semibold"
                            color="text-high"
                          >
                            Recommended
                          </Text>
                          <Box mt="2">
                            <Flex direction="column" gap="2">
                              {softBlockerItems.map((item, i) => (
                                <Flex
                                  key={item.key ?? `soft-${i}`}
                                  gap="2"
                                  align="baseline"
                                >
                                  <Text color="text-mid">•</Text>
                                  <Text
                                    as="div"
                                    weight="semibold"
                                    color="text-mid"
                                  >
                                    {item.display}
                                  </Text>
                                </Flex>
                              ))}
                            </Flex>
                          </Box>
                        </Box>
                      )}
                    </Flex>
                  ) : (
                    <Flex direction="column" gap="2">
                      {incompleteChecklistItems.map((item, i) => (
                        <Flex key={item.key ?? i} gap="2" align="baseline">
                          <Text color="text-mid">•</Text>
                          <Text as="div" weight="semibold" color="text-mid">
                            {item.display}
                          </Text>
                        </Flex>
                      ))}
                    </Flex>
                  )}
                </Box>
              )}
            </Box>
          )}

          {phase && (
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
                  <SummaryRow label="Traffic" inline={!isHoldout}>
                    {isHoldout ? (
                      <Flex direction="column" gap="1">
                        <Text>
                          {Math.floor(
                            phase.coverage * phase.variationWeights[0] * 100,
                          )}
                          % in holdout
                        </Text>
                        <Text>
                          {Math.floor(
                            phase.coverage * phase.variationWeights[0] * 100,
                          )}
                          % not in holdout (for measurement)
                        </Text>
                        <Text>
                          {Math.floor(
                            (1 -
                              phase.coverage * phase.variationWeights[0] * 2) *
                              100,
                          )}
                          % not in holdout (not for measurement)
                        </Text>
                      </Flex>
                    ) : (
                      <Text>
                        {Math.floor(phase.coverage * 100)}% included
                        {!isBandit && (
                          <>
                            , {formatTrafficSplit(phase.variationWeights, 2)}{" "}
                            split
                          </>
                        )}
                      </Text>
                    )}
                  </SummaryRow>
                  {hasAttributeTargeting && (
                    <SummaryRow label="Attribute Targeting">
                      <ConditionDisplay condition={phase.condition} />
                    </SummaryRow>
                  )}
                  {hasSavedGroupTargeting && (
                    <SummaryRow label="Saved Group Targeting">
                      <SavedGroupTargetingDisplay
                        savedGroups={phase.savedGroups}
                      />
                    </SummaryRow>
                  )}
                  {hasPrerequisites && (
                    <SummaryRow label="Prerequisites">
                      <ConditionDisplay prerequisites={phase.prerequisites} />
                    </SummaryRow>
                  )}
                </Flex>
              </Box>
            </Box>
          )}
          {needsVisualEditorUpgrade ? (
            <PremiumCallout
              commercialFeature="visual-editor"
              id="start-experiment-modal"
              mb="3"
            >
              This experiment contains visual editor changes, which require a
              paid plan.
            </PremiumCallout>
          ) : needsRedirectUpgrade ? (
            <PremiumCallout
              commercialFeature="redirects"
              id="start-experiment-modal"
              mb="3"
            >
              This experiment contains URL redirects, which require a paid plan.
            </PremiumCallout>
          ) : isHoldout ? (
            <Text>
              Once started, experiments and features can be added to the
              holdout.
            </Text>
          ) : hasLinkedChanges ? (
            <Box
              mt="3"
              style={{
                backgroundColor: "var(--slate-2)",
                padding: "20px",
                borderRadius: "var(--radius-3)",
              }}
            >
              <Text weight="semibold" color="text-high">
                Linked changes will activate. Users will see experiment
                variations immediately.
              </Text>
              <Flex direction="column" gap="4" mt="3">
                {linkedFeatures.length > 0 && (
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
                {urlRedirects.length > 0 && (
                  <LinkedChangeSection
                    type="redirects"
                    count={urlRedirects.length}
                  >
                    <Flex wrap="wrap" gap="3">
                      {urlRedirects.map((r) => (
                        <Link key={r.id} href={r.urlPattern} target="_blank">
                          <Text weight="semibold">{r.urlPattern}</Text>
                          <PiArrowSquareOut className="ml-1" />
                        </Link>
                      ))}
                    </Flex>
                  </LinkedChangeSection>
                )}
              </Flex>
            </Box>
          ) : null}
        </Modal.Body>
        <Modal.Footer justify="between">
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </Modal.Close>
          <Flex gap="3" align="center">
            {secondaryLabel && secondaryAction && (
              <SecondaryActionButton
                label={secondaryLabel}
                action={secondaryAction}
                close={close}
              />
            )}
            <SubmitButton cta={primaryCta} disabled={primaryDisabled} />
          </Flex>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}
