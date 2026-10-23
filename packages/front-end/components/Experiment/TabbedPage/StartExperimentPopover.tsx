import { ReactNode, useRef, useState } from "react";
import { Flex, Grid, Separator } from "@radix-ui/themes";
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
import { PreLaunchChecklistPanel } from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import { StartExperiment } from "./useStartExperiment";
import useStartGate from "./useStartGate";
import { getStartTitle } from "./startActions";
import {
  StartChecklistFailures,
  StartFailures,
  StartUpgradeCallout,
} from "./StartSections";
import {
  hasStatusSchedule,
  scheduledEnd,
  scheduledTime,
} from "./RunningScheduleLink";
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

/** Starting a draft, or approving its scheduled start: the To Do, then the button. */
export default function StartExperimentPopover({
  open,
  setOpen,
  trigger,
  ...props
}: Props) {
  // Closed to let a To Do item's action take over: focus stays with whatever
  // it opened, or a modal it opened would lose focus and close.
  const handedOff = useRef(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // A refusal belongs to the attempt it was shown for.
        if (!next) props.start.clearStartFailures();
        setOpen(next);
      }}
      onCloseAutoFocus={(e) => {
        if (handedOff.current) e.preventDefault();
        handedOff.current = false;
      }}
      trigger={trigger}
      content={
        <StartContent
          {...props}
          close={() => setOpen(false)}
          handOff={() => {
            handedOff.current = true;
            setOpen(false);
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

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <Text size="sm" color="text-mid">
        {label}
      </Text>
      <Text size="sm" color="text-high">
        {children}
      </Text>
    </>
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
  const gate = useStartGate({ experiment, linkedFeatures, start });
  const editsBlocked = useEditsBlockedReason();
  const end = scheduledEnd(experiment.statusUpdateSchedule);
  const [error, setError] = useState<string | null>(null);

  const startApproved = experiment.nextScheduledStatusUpdate?.type === "start";
  const dateLabel = gate.scheduledStartAt
    ? scheduledTime(gate.scheduledStartAt)
    : null;
  const pastSchedule = !startApproved && gate.schedule === "past" && dateLabel;
  const { checklistItemsRemaining } = usePreLaunchChecklist();
  // Starting publishes what's stored, not what's staged.
  const blockedReason = editsBlocked ?? start.banditBlockedReason;
  const { bypassLabel, waivesApproval } = gate.actions;

  const openSchedule = editSchedule
    ? () => {
        close();
        editSchedule();
      }
    : null;
  const scheduleLink = (text: string) =>
    openSchedule ? <Link onClick={openSchedule}>{text}</Link> : text;

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="baseline" gap="3">
        <Heading as="h4" size="sm" mb="0">
          {getStartTitle(experiment, new Date())}
        </Heading>
        {openSchedule && !startApproved ? (
          <Link
            size="sm"
            onClick={openSchedule}
            style={{ whiteSpace: "nowrap" }}
          >
            {hasStatusSchedule(experiment) ? "Change schedule" : "Add schedule"}
          </Link>
        ) : null}
      </Flex>

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

      <Grid
        columns="max-content minmax(0, 1fr)"
        gapX="5"
        gapY="2"
        align="start"
      >
        <SummaryRow label="Start">{dateLabel ?? "Immediately"}</SummaryRow>
        {end ? <SummaryRow label="Ends">{end}</SummaryRow> : null}
      </Grid>

      <Separator size="4" />

      <Flex direction="column" gap="3">
        {/* Headed as on the details rail. */}
        <Text
          size="sm"
          weight="medium"
          color="text-low"
          textTransform="uppercase"
        >
          {checklistItemsRemaining
            ? `To do (${checklistItemsRemaining})`
            : "To do"}
        </Text>
        {/* Bled out by the rows' hover tint, so the scroll box doesn't clip it. */}
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
            // An item's action goes to where it's resolved, so the popover
            // gets out of the way once the action has run.
            onClick={(e) => {
              if (
                (e.target as HTMLElement).closest("[data-checklist-action]")
              ) {
                handOff();
              }
            }}
          >
            <PreLaunchChecklistPanel />
          </Flex>
        </ScrollArea>
      </Flex>

      <Separator size="4" />

      {startApproved ? (
        <Text size="sm" color="text-low">
          Approved to start on the scheduled date. Edit the schedule to start
          sooner.
        </Text>
      ) : (
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
              value={gate.bypassed}
              setValue={(val) => gate.setBypassed(!!val)}
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
      )}
    </Flex>
  );
}
