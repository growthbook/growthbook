import { ReactNode, useEffect, useRef, useState } from "react";
import { Flex, Separator } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import ScrollArea from "@/ui/ScrollArea";
import {
  ChecklistTodoHeading,
  PreLaunchChecklistPanel,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import { StartExperiment } from "./useStartExperiment";
import useStartGate from "./useStartGate";
import { getStartTitle } from "./startActions";
import {
  StartChecklistFailures,
  StartFailures,
  StartUpgradeCallout,
  SummaryGrid,
  SummaryRow,
} from "./StartSections";
import {
  hasStatusSchedule,
  scheduledEnd,
  scheduledTime,
} from "./statusSchedule";
import { useEditsBlockedReason } from "./ExperimentEdits";

type ContentProps = {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  start: StartExperiment;
  editSchedule: (() => void) | null;
};

export type Props = ContentProps & {
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: ReactNode;
};

// A modal opened from the popover stacks over it, so the popover stays open
// beneath. Non-modal dialogs, like the AI assistant's panel, don't count.
const modalOpen = () =>
  !!document.querySelector(
    '.rt-BaseDialogContent[data-state="open"], [aria-modal="true"]',
  );

/** Starting a draft, or approving its scheduled start: the To Do, then the button. */
export default function StartExperimentPopover({
  open,
  setOpen,
  trigger,
  ...props
}: Props) {
  // Closed to let a To Do item's action take over: focus stays where it went.
  const handedOff = useRef(false);
  const close = () => {
    // A refusal belongs to the attempt it was shown for.
    props.start.clearStartFailures();
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else if (!modalOpen()) close();
      }}
      onCloseAutoFocus={(e) => {
        if (handedOff.current) e.preventDefault();
        handedOff.current = false;
      }}
      trigger={trigger}
      content={
        <StartContent
          {...props}
          close={close}
          handOff={() => {
            handedOff.current = true;
            close();
          }}
        />
      }
      side="bottom"
      align="end"
      contentStyle={{
        padding: 20,
        width: 380,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 140px)",
        overflowY: "auto",
      }}
    />
  );
}

function StartContent({
  experiment,
  linkedFeatures,
  start,
  editSchedule,
  close,
  handOff,
}: ContentProps & { close: () => void; handOff: () => void }) {
  const [bypassed, setBypassed] = useState(false);
  // A refusal's items need their own acknowledgment, not an earlier tick.
  useEffect(() => {
    if (start.checklistFailures.length) setBypassed(false);
  }, [start.checklistFailures]);
  const gate = useStartGate({ experiment, linkedFeatures, start, bypassed });
  const { bypassLabel, waivesApproval } = gate.actions;
  // A tick agrees to the bypass its label named; a new label needs a new tick.
  const [tickedLabel, setTickedLabel] = useState(bypassLabel);
  if (tickedLabel !== bypassLabel) {
    setTickedLabel(bypassLabel);
    setBypassed(false);
  }
  const editsBlocked = useEditsBlockedReason();
  const end = scheduledEnd(experiment.statusUpdateSchedule);
  const [error, setError] = useState<string | null>(null);

  const dateLabel = gate.scheduledStartAt
    ? scheduledTime(gate.scheduledStartAt)
    : null;
  const pastSchedule = gate.schedule === "past" && dateLabel;
  const { checklistItemsRemaining, loadError, summary } =
    usePreLaunchChecklist();
  const showTodo =
    checklistItemsRemaining !== 0 || loadError || summary.flagged.length > 0;
  // Starting publishes what's stored, not what's staged.
  const blockedReason = editsBlocked ?? start.banditBlockedReason;

  const scheduleLink = (text: string) =>
    editSchedule ? <Link onClick={editSchedule}>{text}</Link> : text;

  return (
    <Flex direction="column" gap="4">
      <Heading as="h4" size="sm" mb="0">
        {getStartTitle(experiment, new Date(), true)}
      </Heading>

      <StartFailures failures={start.pendingDraftFailures} />
      <StartChecklistFailures items={start.checklistFailures} />
      {pastSchedule ? (
        <Callout status="warning" size="sm">
          The scheduled start date{" "}
          <Text size="sm" weight="semibold">
            {dateLabel}
          </Text>{" "}
          has passed.{" "}
          {gate.checklistLoading || gate.upgrade ? (
            <>{scheduleLink("Update the schedule")}.</>
          ) : gate.actions.hardBlocked ? (
            <>
              Resolve the items below, or {scheduleLink("update the schedule")}.
            </>
          ) : (
            <>
              Click{" "}
              <Text size="sm" weight="semibold">
                {gate.actions.label}
              </Text>{" "}
              to start the experiment immediately, or{" "}
              {scheduleLink("update the schedule")}.
            </>
          )}
        </Callout>
      ) : null}
      <StartUpgradeCallout upgrade={gate.upgrade} />

      <SummaryGrid>
        <SummaryRow
          label="Start"
          action={
            editSchedule ? (
              <Link
                size="sm"
                onClick={editSchedule}
                style={{ whiteSpace: "nowrap" }}
              >
                {hasStatusSchedule(experiment)
                  ? "Edit schedule"
                  : "Add schedule"}
              </Link>
            ) : null
          }
        >
          {dateLabel ?? "Immediately"}
        </SummaryRow>
        {end ? <SummaryRow label="Ends">{end}</SummaryRow> : null}
      </SummaryGrid>

      {showTodo ? (
        <>
          <Separator size="4" />
          <Flex direction="column" gap="3">
            <ChecklistTodoHeading remaining={checklistItemsRemaining} />
            {/* Bleeds out so the scroll box doesn't clip the rows' hover tint. */}
            <ScrollArea
              gutter
              style={{
                maxHeight: 250,
                marginInline: "calc(-1 * var(--space-2))",
              }}
            >
              <Flex
                direction="column"
                gap="3"
                px="2"
                py="2"
                // The popover waits under a modal an item's action opens, and
                // closes for anything else.
                onClick={(e) => {
                  if (
                    !(e.target as HTMLElement).closest(
                      "[data-checklist-action]",
                    )
                  ) {
                    return;
                  }
                  // Once the action's render has committed.
                  setTimeout(() => {
                    if (!modalOpen()) handOff();
                  });
                }}
              >
                <PreLaunchChecklistPanel />
              </Flex>
            </ScrollArea>
          </Flex>

          <Separator size="4" />
        </>
      ) : null}

      <Flex direction="column" gap="3">
        {bypassLabel ? (
          <Checkbox
            size="sm"
            labelSize="sm"
            label={
              waivesApproval ? (
                <span style={{ color: "var(--red-11)" }}>{bypassLabel}</span>
              ) : (
                bypassLabel
              )
            }
            weight="regular"
            value={bypassed}
            setValue={(val) => setBypassed(!!val)}
          />
        ) : null}
        {error ? (
          <Callout status="error" size="sm">
            {error}
          </Callout>
        ) : null}
        <Flex justify="end" align="center" gap="3">
          <Tooltip content={blockedReason} enabled={!!blockedReason}>
            <Button
              onClick={async () => {
                await gate.runPrimary();
                close();
              }}
              setError={setError}
              disabled={gate.actions.disabled || !!blockedReason}
            >
              {gate.actions.label}
            </Button>
          </Tooltip>
        </Flex>
      </Flex>
    </Flex>
  );
}
