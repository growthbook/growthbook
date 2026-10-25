import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { date, daysBetween } from "shared/dates";
import { PiWarning, PiWarningFill } from "react-icons/pi";
import { HoldoutInterfaceStringDates } from "shared/validators";
import Text from "@/ui/Text";
import SortedTags from "@/components/Tags/SortedTags";
import { tagLinkProps } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import UITooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import Owner from "@/components/Avatar/Owner";
import Metadata from "@/ui/Metadata";
import {
  hasStatusSchedule,
  scheduledEnd,
  scheduledTime,
} from "@/components/Experiment/TabbedPage/statusSchedule";
import Link from "@/ui/Link";
import { useHoldouts } from "@/hooks/useHoldouts";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import { getHealthStateFromDetailedStatus } from "@/services/experiments";
import ProjectBadges from "@/components/ProjectBadges";
import { getStartSchedule } from "./startActions";

export type QuickEditField =
  | "project"
  | "trackingKey"
  | "owner"
  | "tags"
  | "schedule";

// The quick-edit button for one field's row, where that field is editable.
type FieldAction = ((field: QuickEditField) => ReactNode) | null;

const toUTCDate = (dateValue: string | Date) => date(dateValue, "UTC");

export function EmptyValue() {
  return (
    <Text weight="regular" color="text-mid" size="sm" fontStyle="italic">
      None
    </Text>
  );
}

export function ExperimentDataFields({
  experiment,
  stagedHoldoutId = null,
  fieldAction = null,
}: {
  experiment: ExperimentInterfaceStringDates;
  // A staged holdout ("" to leave), shown in place of the stored one.
  stagedHoldoutId?: string | null;
  fieldAction?: FieldAction;
}) {
  const holdoutId = stagedHoldoutId ?? experiment.holdoutId ?? "";
  // Only needed to name the holdout this experiment belongs to.
  const { holdoutsMap } = useHoldouts(undefined, false, {
    enabled: !!holdoutId,
  });
  const { useStickyBucketing } = useOrgSettings();
  const isHoldout = experiment.type === "holdout";

  return (
    <Flex direction="column" gap="3">
      {!isHoldout && (
        <Metadata
          size="sm"
          stacked
          label="Experiment Key"
          action={fieldAction?.("trackingKey")}
          value={experiment.trackingKey || <EmptyValue />}
        />
      )}
      {holdoutId && (
        <Metadata
          size="sm"
          stacked
          label="Holdout"
          value={
            <Link href={`/holdout/${holdoutId}`}>
              {holdoutsMap.get(holdoutId)?.name}
            </Link>
          }
        />
      )}
      <Metadata
        size="sm"
        stacked
        label="Assignment attribute"
        value={
          experiment.fallbackAttribute
            ? `${experiment.hashAttribute}, falling back to ${experiment.fallbackAttribute}`
            : experiment.hashAttribute || "id"
        }
      />
      {!isHoldout && useStickyBucketing ? (
        <Metadata
          size="sm"
          stacked
          label="Sticky bucketing"
          value={experiment.disableStickyBucketing ? "Disabled" : "Enabled"}
        />
      ) : null}
    </Flex>
  );
}

export default function ProjectTagBar({
  experiment,
  holdout,
  fieldAction = null,
}: {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  fieldAction?: FieldAction;
}) {
  const {
    projects,
    project: currentProject,
    getProjectById,
  } = useDefinitions();

  const projectId = experiment.project;
  const projectName = getProjectById(experiment.project || "")?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const statusIndicator = useExperimentStatusIndicator()(experiment);
  // A data problem shows as a health badge below, so the status leaves it out.
  const statusDetail = getHealthStateFromDetailedStatus(
    statusIndicator.detailedStatus,
  )
    ? null
    : statusIndicator.detailedStatus;
  const isHoldout = experiment.type === "holdout";

  const projectValue = projectIsDeReferenced ? (
    <Tooltip
      body={
        <>
          Project <code>{projectId}</code> not found
        </>
      }
    >
      <span className="text-danger">
        <PiWarning /> Invalid project
      </span>
    </Tooltip>
  ) : !projectId ? (
    <EmptyValue />
  ) : currentProject && currentProject !== experiment.project ? (
    <Tooltip body={<>This experiment is not in your current project.</>}>
      <strong>{projectName}</strong> <PiWarning className="text-warning" />
    </Tooltip>
  ) : (
    <Text weight="regular" color="text-mid" size="sm">
      {projectName}
    </Text>
  );

  return (
    <Flex direction="column" gap="3">
      <Metadata
        size="sm"
        stacked
        label="Owner"
        action={fieldAction?.("owner")}
        value={
          <Owner
            ownerId={experiment.owner}
            gap="1"
            size="xs"
            textColor="text-mid"
            textSize="sm"
            truncate
          />
        }
      />
      {holdout ? (
        <Metadata
          size="sm"
          stacked
          label="Projects"
          value={
            holdout.projects.length > 0 ? (
              <ProjectBadges
                resourceType="holdout"
                projectIds={holdout.projects}
              />
            ) : (
              <EmptyValue />
            )
          }
        />
      ) : projects.length > 0 || projectIsDeReferenced ? (
        <Metadata
          size="sm"
          stacked
          label="Project"
          action={fieldAction?.("project")}
          value={projectValue}
        />
      ) : null}
      <Metadata
        size="sm"
        stacked
        label="Tags"
        action={fieldAction?.("tags")}
        value={
          experiment.tags?.length > 0 ? (
            <SortedTags
              tags={experiment.tags}
              size="xs"
              useFlex
              shouldShowEllipsis={false}
              {...tagLinkProps("experiments")}
            />
          ) : (
            <EmptyValue />
          )
        }
      />
      <Metadata
        size="sm"
        stacked
        label="Status"
        value={
          <Text size="sm" color="text-high">
            {statusIndicator.status}
            {statusDetail ? (
              <Text size="sm" color="text-mid">
                {" "}
                · {statusDetail}
              </Text>
            ) : null}
          </Text>
        }
      />
      <ExperimentDates experiment={experiment} />
      {experiment.status === "draft" && !isHoldout ? (
        <DraftSchedule
          experiment={experiment}
          action={
            experiment.archived ? null : (fieldAction?.("schedule") ?? null)
          }
        />
      ) : null}
      {experiment.status === "running" &&
      !isHoldout &&
      experiment.type !== "multi-armed-bandit" &&
      !experiment.archived ? (
        <RunningSchedule
          experiment={experiment}
          action={fieldAction?.("schedule") ?? null}
        />
      ) : null}
    </Flex>
  );
}

function PassedDate({
  warning,
  children,
}: {
  warning: string;
  children: ReactNode;
}) {
  return (
    <Flex align="center" gap="1">
      <UITooltip content={warning}>
        <span style={{ display: "inline-flex" }}>
          <PiWarningFill color="var(--warning)" />
        </span>
      </UITooltip>
      <Text size="sm" color="text-high">
        {children}
      </Text>
    </Flex>
  );
}

function DraftSchedule({
  experiment,
  action,
}: {
  experiment: ExperimentInterfaceStringDates;
  action: ReactNode;
}) {
  const schedule = experiment.statusUpdateSchedule;
  const startPassed =
    getStartSchedule(
      schedule?.startAt ? new Date(schedule.startAt) : null,
      new Date(),
    ) === "past";
  const end = scheduledEnd(schedule);
  if (!hasStatusSchedule(experiment)) {
    return action ? (
      <Metadata
        size="sm"
        stacked
        label="Schedule"
        value={<EmptyValue />}
        action={action}
      />
    ) : null;
  }
  return (
    <>
      {schedule?.startAt ? (
        <Metadata
          size="sm"
          stacked
          label="Scheduled start"
          action={action}
          value={
            startPassed ? (
              <PassedDate warning="This start time has passed. Edit the schedule to set a new one.">
                {scheduledTime(schedule.startAt)}
              </PassedDate>
            ) : (
              scheduledTime(schedule.startAt)
            )
          }
        />
      ) : null}
      {end ? (
        <Metadata
          size="sm"
          stacked
          label="Scheduled end"
          action={action}
          value={end}
        />
      ) : null}
    </>
  );
}

// Only the end: the start is past, and a relative stopAfter resolved to a
// stopAt when it began.
function RunningSchedule({
  experiment,
  action,
}: {
  experiment: ExperimentInterfaceStringDates;
  action: ReactNode;
}) {
  const end = scheduledEnd(experiment.statusUpdateSchedule);
  if (!end && !action) return null;
  // A passed end means a notify-mode end already fired and deliberately kept
  // the experiment running, so it says so rather than implying a future stop.
  const stopAt = experiment.statusUpdateSchedule?.stopAt;
  const endPassed = !!stopAt && new Date(stopAt) <= new Date();
  return (
    <Metadata
      size="sm"
      stacked
      label="Scheduled end"
      action={action}
      value={
        !end ? (
          <EmptyValue />
        ) : endPassed ? (
          <PassedDate warning="This end has passed, and the experiment kept running. Edit the schedule to set a new one.">
            {end}
          </PassedDate>
        ) : (
          end
        )
      }
    />
  );
}

function ExperimentDates({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const phases = experiment.phases || [];
  const lastPhase = phases[phases.length - 1];
  const started =
    experiment.type === "holdout"
      ? phases[0]?.dateStarted
      : lastPhase?.dateStarted;
  const created = toUTCDate(experiment.dateCreated);

  if (experiment.status === "draft" || !started) {
    return <Metadata size="sm" stacked label="Created" value={created} />;
  }

  const running = experiment.status === "running";
  // Stopped experiments usually have an end date; older ones may not.
  const ended = running ? null : lastPhase?.dateEnded;
  const days = daysBetween(started, ended || new Date());
  const duration =
    days < 1 ? "under a day" : `${days} ${days === 1 ? "day" : "days"}`;
  const latest = phases.length > 1 && experiment.type !== "holdout";
  return (
    <Metadata
      size="sm"
      stacked
      label={
        ended
          ? latest
            ? "Latest phase ran"
            : "Ran"
          : latest
            ? "Latest phase started"
            : "Started"
      }
      value={
        <Tooltip body={`Created ${created}`}>
          <Text weight="regular" color="text-high" size="sm">
            {ended
              ? `${toUTCDate(started)} – ${toUTCDate(ended)} · ${duration}`
              : running
                ? `${toUTCDate(started)} · ${duration} so far`
                : toUTCDate(started)}
          </Text>
        </Tooltip>
      }
    />
  );
}
