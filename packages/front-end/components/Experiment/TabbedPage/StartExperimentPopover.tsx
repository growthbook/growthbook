import { Fragment, ReactNode, useState } from "react";
import omit from "lodash/omit";
import { format } from "date-fns";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
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
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import {
  ChecklistCountBadge,
  PreLaunchChecklistPanel,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import { useChecklistSummary } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import { isFlagDraftItem } from "@/components/PreLaunchChecklist/checklistSummary";
import { useAuth } from "@/services/auth";
import { useManagedExperimentFlags } from "@/hooks/useManagedExperimentFlags";
import { StartExperiment } from "./useStartExperiment";
import useStartGate from "./useStartGate";
import { getStartTitle } from "./startActions";
import {
  StartChecklistFailures,
  StartFailures,
  StartSummaryRow,
  StartUpgradeCallout,
  useStartSummaryRows,
} from "./StartSections";
import { scheduledEnd, scheduledTime } from "./RunningScheduleLink";
import { useEditsBlockedReason } from "./ExperimentEdits";

// getAffectedEnvsForExperiment's answer for "every environment".
const ALL_ENVIRONMENTS = "__ALL__";

type ContentProps = {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  envs: string[];
  start: StartExperiment;
  editSchedule: (() => void) | null;
  mutate: () => void;
  // The Values flag's review status and next step; its To Do rows give way.
  valuesStatus?: ReactNode;
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
      contentStyle={{
        padding: 20,
        width: 480,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 140px)",
        overflowY: "auto",
      }}
    />
  );
}

// In the date field's local format.
const toLocalInput = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

/** Now, or a date the popover saves as the schedule's start. */
function StartTimeField({
  experiment,
  mutate,
  container,
  setError,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  // The popover, so the select's menu opens inside it.
  container: HTMLElement | null;
  setError: (error: string | null) => void;
}) {
  const { apiCall } = useAuth();
  const startAt = experiment.statusUpdateSchedule?.startAt;
  const [draft, setDraft] = useState(() =>
    startAt ? toLocalInput(new Date(startAt)) : "",
  );

  const save = async (next: Date | null) => {
    setError(null);
    if (next && next <= new Date()) {
      setError("Pick a start time in the future.");
      return;
    }
    const rest = omit(experiment.statusUpdateSchedule ?? {}, "startAt");
    try {
      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({
          statusUpdateSchedule: next
            ? { ...rest, startAt: next.toISOString() }
            : rest.stopAt || rest.stopAfter
              ? rest
              : null,
        }),
      });
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Select
        value={startAt ? "date" : "now"}
        setValue={(value) => {
          if (value === "now") {
            setDraft("");
            void save(null);
            return;
          }
          // The next whole hour, a ready default to adjust.
          const next = new Date();
          next.setHours(next.getHours() + 1, 0, 0, 0);
          setDraft(toLocalInput(next));
          void save(next);
        }}
        container={container}
        size="sm"
      >
        <SelectItem value="now">Immediately</SelectItem>
        <SelectItem value="date">On a date</SelectItem>
      </Select>
      {startAt ? (
        <TextField
          type="datetime-local"
          size="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // On leaving the field, so a half-typed time isn't saved.
          onBlur={() => {
            const next = draft ? new Date(draft) : null;
            if (
              next &&
              !Number.isNaN(next.getTime()) &&
              next.toISOString() !== new Date(startAt).toISOString()
            ) {
              void save(next);
            }
          }}
        />
      ) : null}
    </Flex>
  );
}

function useSummaryRows(
  experiment: ExperimentInterfaceStringDates,
  envs: string[],
): StartSummaryRow[] {
  const rows = [...useStartSummaryRows(experiment)];
  if (experiment.phases?.length) {
    rows.push({
      key: "assignmentAttribute",
      label: "Assignment attribute",
      inline: true,
      value: [experiment.hashAttribute || "id", experiment.fallbackAttribute]
        .filter(Boolean)
        .join(", "),
    });
  }
  // Visual Editor changes and redirects serve everywhere.
  const allEnvs = envs.includes(ALL_ENVIRONMENTS);
  if (envs.length > 0) {
    rows.push({
      key: "environments",
      label: envs.length === 1 && !allEnvs ? "Environment" : "Environments",
      inline: true,
      value: allEnvs ? "All environments" : envs.join(", "),
    });
  }
  const end = scheduledEnd(experiment.statusUpdateSchedule);
  if (end) rows.push({ key: "end", label: "Ends", inline: true, value: end });
  return rows;
}

function StartContent({
  experiment,
  linkedFeatures,
  envs,
  start,
  editSchedule,
  mutate,
  valuesStatus,
  close,
}: ContentProps & { close: () => void }) {
  const gate = useStartGate({ experiment, linkedFeatures, start });
  const editsBlocked = useEditsBlockedReason();
  const rows = useSummaryRows(experiment, envs);
  const [error, setError] = useState<string | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const startApproved = experiment.nextScheduledStatusUpdate?.type === "start";
  const dateLabel = gate.scheduledStartAt
    ? scheduledTime(gate.scheduledStartAt)
    : null;
  const pastSchedule = !startApproved && gate.schedule === "past" && dateLabel;
  const managedId =
    useManagedExperimentFlags({ experiment, linkedFeatures }).managedFeature
      ?.feature.id ?? null;
  // The values' own row stands in for their To Do rows.
  const omitted =
    valuesStatus && managedId
      ? (item: Parameters<typeof isFlagDraftItem>[0]) =>
          isFlagDraftItem(item, managedId)
      : undefined;
  const shown = useChecklistSummary(omitted);
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
    <Flex ref={setContainer} direction="column" gap="4">
      <Heading as="h4" size="sm" mb="0">
        {getStartTitle(experiment, new Date())}
      </Heading>

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

      <Grid
        columns="max-content minmax(0, 1fr)"
        gapX="4"
        gapY="3"
        align="center"
      >
        <Text color="text-low">Start</Text>
        {openSchedule && !startApproved ? (
          <Flex align="center" gap="3" wrap="wrap">
            <StartTimeField
              experiment={experiment}
              mutate={mutate}
              container={container}
              setError={setError}
            />
            <Link onClick={openSchedule}>More options</Link>
          </Flex>
        ) : (
          <Text color="text-high">{dateLabel ?? "Immediately"}</Text>
        )}
        {rows.map((row) => (
          <Fragment key={row.key}>
            <Text color="text-low">{row.label}</Text>
            <Box style={{ color: "var(--color-text-high)", minWidth: 0 }}>
              {row.value}
            </Box>
          </Fragment>
        ))}
      </Grid>

      <Separator size="4" />

      <Flex direction="column" gap="3">
        <Flex align="center" gap="2">
          <Text weight="semibold" color="text-high">
            To Do
          </Text>
          <ChecklistCountBadge
            remaining={gate.checklistLoading ? null : shown.remaining}
            blocking={shown.blocking > 0}
          />
        </Flex>
        {valuesStatus}
        <Flex
          direction="column"
          gap="3"
          // An item's link goes to where it's resolved, so the popover gets
          // out of the way; folding the completed ones stays here.
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest("a:not([aria-expanded])")) {
              close();
            }
          }}
        >
          <PreLaunchChecklistPanel size="md" foldCompleted omit={omitted} />
        </Flex>
      </Flex>

      <Separator size="4" />

      {startApproved ? (
        <Text color="text-low">
          Approved to start on the scheduled date. Edit the schedule to start
          sooner.
        </Text>
      ) : (
        <Flex direction="column" gap="3">
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
        </Flex>
      )}
    </Flex>
  );
}
