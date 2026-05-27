import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { format } from "date-fns-tz";
import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Modal, { useModalContext } from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import { useUser } from "@/services/UserContext";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumCallout from "@/ui/PremiumCallout";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  startExperiment: () => Promise<void>;
  scheduleExperiment?: () => Promise<void>;
  checklistItemsRemaining: number;
  checklistHardBlockerCount?: number;
  isHoldout?: boolean;
}

function SubmitButton({ cta, disabled }: { cta: string; disabled: boolean }) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" disabled={disabled} loading={loading}>
      {cta}
    </Button>
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
}: Props) {
  const checklistIncomplete = checklistItemsRemaining > 0;
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
          {checklistIncomplete && (
            <Callout status={hasHardBlockers ? "error" : "warning"} mb="3">
              You have{" "}
              <Text weight="semibold">
                {checklistItemsRemaining} task
                {checklistItemsRemaining > 1 ? "s" : ""}
              </Text>{" "}
              left to complete.{" "}
              {hasHardBlockers
                ? "Some can't be bypassed — resolve them in the Pre-Launch Checklist before this experiment can start."
                : "Review the Pre-Launch Checklist before starting this experiment."}
            </Callout>
          )}
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
          ) : (
            <Text>
              Once started, linked changes will be activated and users will
              begin to see your experiment variations{" "}
              <Text weight="semibold">immediately</Text>.
            </Text>
          )}
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
