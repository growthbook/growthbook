import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { date, daysBetween } from "shared/dates";
import { PiWarning } from "react-icons/pi";
import {
  HoldoutInterfaceStringDates,
  ImplementationType,
} from "shared/validators";
import { getImplementationType, isAnalysisOnly } from "shared/util";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";
import Text from "@/ui/Text";
import SortedTags from "@/components/Tags/SortedTags";
import { tagLinkProps } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import Owner from "@/components/Avatar/Owner";
import Metadata from "@/ui/Metadata";
import RunningScheduleLink from "@/components/Experiment/TabbedPage/RunningScheduleLink";
import Link from "@/ui/Link";
import { ManagedFlagLink } from "@/components/Experiment/ManagedFlagName";
import { useHoldouts } from "@/hooks/useHoldouts";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import { getHealthStateFromDetailedStatus } from "@/services/experiments";
import ProjectBadges from "@/components/ProjectBadges";

export interface Props {
  /** The managed Feature Flag the experiment owns, if any. */
  managedFlagId?: string | null;
  /** An implementation type staged for the page's Save, shown in place of the stored one. */
  stagedImplementationType?: ImplementationType | null;
  /** A staged holdout ("" to leave), shown in place of the stored one. */
  stagedHoldoutId?: string | null;
  /** Opens the schedule editor, where the schedule can change. */
  editSchedule?: (() => void) | null;
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  /**
   * Which of the side panel's blocks to render: who and what the experiment
   * is and when it ran, or how it is set up.
   */
  panel: "about" | "details";
  /** The quick-edit button for one field's row, where that field is editable. */
  fieldAction?: (
    field: "project" | "trackingKey" | "owner" | "tags",
  ) => ReactNode;
}

const toUTCDate = (dateValue: string | Date) => date(dateValue, "UTC");

const empty = (label = "None") => (
  <Text weight="regular" color="text-mid" size="sm" fontStyle="italic">
    {label}
  </Text>
);

export default function ProjectTagBar({
  experiment,
  holdout,
  managedFlagId = null,
  stagedImplementationType = null,
  stagedHoldoutId = null,
  editSchedule = null,
  panel,
  fieldAction,
}: Props) {
  const {
    projects,
    project: currentProject,
    getProjectById,
  } = useDefinitions();

  const projectId = experiment.project;
  const projectName = getProjectById(experiment.project || "")?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const holdoutId = stagedHoldoutId ?? experiment.holdoutId ?? "";
  // Only needed to name the holdout this experiment belongs to.
  const { holdoutsMap } = useHoldouts(undefined, false, {
    enabled: !!holdoutId,
  });

  const statusIndicator = useExperimentStatusIndicator()(experiment);
  const { useStickyBucketing } = useOrgSettings();
  // A data problem shows as a health badge below, so the status leaves it out.
  const statusDetail = getHealthStateFromDetailedStatus(
    statusIndicator.detailedStatus,
  )
    ? null
    : statusIndicator.detailedStatus;
  const isHoldout = experiment.type === "holdout";
  // Experiments adopted before the type was stored only carry the flag's marker.
  const implementationType = stagedImplementationType
    ? stagedImplementationType
    : managedFlagId
      ? "values"
      : getImplementationType(experiment);

  if (panel === "details") {
    return (
      <Flex direction="column" gap="3">
        {!isHoldout && (
          <Metadata
            size="sm"
            stacked
            label="Implementation"
            // Staged with the page's other edits, so it's changed on the left.
            value={
              implementationType
                ? IMPLEMENTATION_TYPE_OPTIONS[implementationType].header
                : empty("Not set")
            }
          />
        )}
        {!isHoldout && implementationType === "values" && managedFlagId ? (
          <Metadata
            size="sm"
            stacked
            label="Managed flag"
            value={<ManagedFlagLink featureId={managedFlagId} />}
          />
        ) : null}
        {!isHoldout && useStickyBucketing && !isAnalysisOnly(experiment) ? (
          <Metadata
            size="sm"
            stacked
            label="Sticky bucketing"
            value={experiment.disableStickyBucketing ? "Disabled" : "Enabled"}
          />
        ) : null}
        {!isHoldout && (
          <Metadata
            size="sm"
            stacked
            label="Experiment Key"
            actionPlacement="value"
            action={fieldAction?.("trackingKey")}
            value={experiment.trackingKey || empty()}
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
      </Flex>
    );
  }

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
    empty()
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
        actionPlacement="value"
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
              empty()
            )
          }
        />
      ) : projects.length > 0 || projectIsDeReferenced ? (
        <Metadata
          size="sm"
          stacked
          label="Project"
          actionPlacement="value"
          action={fieldAction?.("project")}
          value={projectValue}
        />
      ) : null}
      <Metadata
        size="sm"
        stacked
        label="Tags"
        actionPlacement="value"
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
            empty()
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
      <Flex direction="column" gap="1">
        <ExperimentDates experiment={experiment} />
        {editSchedule &&
        experiment.status === "running" &&
        experiment.type !== "holdout" &&
        experiment.type !== "multi-armed-bandit" &&
        !experiment.archived ? (
          <RunningScheduleLink
            experiment={experiment}
            editSchedule={editSchedule}
          />
        ) : null}
      </Flex>
    </Flex>
  );
}

/**
 * When the experiment ran, as far as it has: created while a draft, started
 * while running, and the whole span once stopped (or just the start, where an
 * old stopped experiment never recorded its end). A holdout counts from its
 * first phase; anything else from its latest, and says so when it has had
 * more than one.
 */
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
