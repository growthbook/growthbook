import { ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { isManagedByExperiment } from "shared/util";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  ChecklistCountBadge,
  PreLaunchChecklistPanel,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import { StartExperiment } from "./useStartExperiment";
import useStartGate from "./useStartGate";
import { getStartTitle } from "./startActions";
import {
  StartChecklistFailures,
  StartFailures,
  StartSummary,
  StartSummaryRow,
  StartUpgradeCallout,
} from "./StartSections";
import { scheduledTime } from "./RunningScheduleLink";
import { useEditsBlockedReason } from "./ExperimentEdits";

// getAffectedEnvsForExperiment's answer for "every environment".
const ALL_ENVIRONMENTS = "__ALL__";

type ContentProps = {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  envs: string[];
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
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // A refusal belongs to the attempt it was shown for.
        if (!next) props.start.clearStartFailures();
        setOpen(next);
      }}
      trigger={trigger}
      content={<StartContent {...props} close={() => setOpen(false)} />}
      side="bottom"
      align="end"
      showArrow={false}
      contentStyle={{
        padding: 16,
        width: 440,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 140px)",
        overflowY: "auto",
      }}
    />
  );
}

function useExtraSummaryRows(
  experiment: ExperimentInterfaceStringDates,
  envs: string[],
): StartSummaryRow[] {
  const rows: StartSummaryRow[] = [];
  if (experiment.phases?.length) {
    rows.push({
      key: "assignmentAttribute",
      label: "Assignment attribute",
      inline: true,
      value: (
        <Text>
          {[experiment.hashAttribute || "id", experiment.fallbackAttribute]
            .filter(Boolean)
            .join(", ")}
        </Text>
      ),
    });
  }
  // Visual Editor changes and redirects serve everywhere.
  const allEnvs = envs.includes(ALL_ENVIRONMENTS);
  if (envs.length > 0) {
    rows.push({
      key: "environments",
      label: envs.length === 1 && !allEnvs ? "Environment" : "Environments",
      inline: true,
      value: <Text>{allEnvs ? "All environments" : envs.join(", ")}</Text>,
    });
  }
  const schedule = experiment.statusUpdateSchedule;
  if (schedule?.stopAt || schedule?.stopAfter) {
    rows.push({
      key: "end",
      label: "Ends",
      inline: true,
      value: (
        <Text>
          {schedule.stopAt
            ? scheduledTime(schedule.stopAt)
            : `${schedule.stopAfter?.value} ${schedule.stopAfter?.unit} after start`}
        </Text>
      ),
    });
  }
  return rows;
}

function StartContent({
  experiment,
  linkedFeatures,
  envs,
  start,
  editSchedule,
  close,
}: ContentProps & { close: () => void }) {
  const gate = useStartGate({ experiment, linkedFeatures, start });
  const editsBlocked = useEditsBlockedReason();
  const extraRows = useExtraSummaryRows(experiment, envs);
  const [error, setError] = useState<string | null>(null);

  const startApproved = experiment.nextScheduledStatusUpdate?.type === "start";
  const dateLabel = gate.scheduledStartAt
    ? scheduledTime(gate.scheduledStartAt)
    : null;
  const pastSchedule = !startApproved && gate.schedule === "past" && dateLabel;
  const managedId =
    linkedFeatures.find((f) => isManagedByExperiment(f.feature, experiment.id))
      ?.feature.id ?? null;
  // Starting publishes what's stored, not what's staged.
  const blockedReason = editsBlocked ?? start.banditBlockedReason;
  const { bypassLabel, waivesApproval } = gate.actions;

  const scheduleLink = (text: string) =>
    editSchedule ? (
      <Link
        onClick={() => {
          close();
          editSchedule();
        }}
      >
        {text}
      </Link>
    ) : (
      text
    );

  return (
    <Flex direction="column" gap="3">
      <Box>
        <Heading as="h4" size="sm" mb="0">
          {getStartTitle(experiment, new Date())}
        </Heading>
        {gate.schedule === "future" && !startApproved && dateLabel ? (
          <Text as="div" size="sm" color="text-low" mt="1">
            Scheduled to start {dateLabel}
          </Text>
        ) : null}
      </Box>
      <StartFailures
        failures={start.pendingDraftFailures}
        managedFeatureId={managedId}
      />
      <StartChecklistFailures items={start.checklistFailures} />
      {pastSchedule ? (
        <Callout status="warning" size="sm">
          The scheduled start date <Text weight="semibold">{dateLabel}</Text>{" "}
          has passed.{" "}
          {gate.checklistLoading || gate.upgrade ? (
            <>{scheduleLink("Update the schedule")}.</>
          ) : gate.actions.hardBlocked ? (
            <>
              Resolve the items below, or {scheduleLink("update the schedule")}.
            </>
          ) : (
            <>
              Click <Text weight="semibold">{gate.actions.label}</Text> to start
              the experiment immediately, or{" "}
              {scheduleLink("update the schedule")}.
            </>
          )}
        </Callout>
      ) : null}
      <StartUpgradeCallout upgrade={gate.upgrade} />
      <StartSummary experiment={experiment} extraRows={extraRows} />
      <Separator size="4" />
      <Flex align="center" gap="2">
        <Text weight="semibold" color="text-high">
          To Do
        </Text>
        <ChecklistCountBadge
          remaining={gate.checklistLoading ? null : gate.summary.remaining}
          blocking={gate.summary.blocking > 0}
        />
      </Flex>
      <Flex
        direction="column"
        gap="3"
        // An item's link goes to where it's resolved, so the popover gets out
        // of the way; folding the completed ones stays here.
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a:not([aria-expanded])")) {
            close();
          }
        }}
      >
        <PreLaunchChecklistPanel size="sm" foldCompleted />
      </Flex>
      <Separator size="4" />
      {startApproved ? (
        <Text size="sm" color="text-low">
          Approved to start on the scheduled date. Edit the schedule to start
          sooner.
        </Text>
      ) : (
        <>
          {bypassLabel ? (
            <Checkbox
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
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
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
        </>
      )}
    </Flex>
  );
}
