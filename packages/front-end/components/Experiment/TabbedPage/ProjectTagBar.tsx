import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { date } from "shared/dates";
import { PiLockSimple, PiWarning } from "react-icons/pi";
import { HoldoutInterfaceStringDates } from "shared/validators";
import {
  getExposureQueryIdentifierTypes,
  resolveAnalysisIdentifierType,
} from "shared/util";
import Text from "@/ui/Text";
import SortedTags from "@/components/Tags/SortedTags";
import { tagLinkProps } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import UITooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import Owner from "@/components/Avatar/Owner";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import { useHoldouts } from "@/hooks/useHoldouts";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import ProjectBadges from "@/components/ProjectBadges";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { useStagedState } from "./ExperimentEdits";
import { runLength } from "./statusSchedule";

export type QuickEditField = "project" | "trackingKey" | "owner" | "tags";

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

export function RestrictedValue() {
  return (
    <UITooltip content="This Data Source is in a Project you don't have access to.">
      {/* Focusable, so the reason reaches the keyboard too. */}
      <Flex
        as="span"
        align="center"
        gap="1"
        tabIndex={0}
        style={{ display: "inline-flex" }}
      >
        <PiLockSimple />
        <em>Restricted</em>
      </Flex>
    </UITooltip>
  );
}

export function ExperimentDataFields({
  experiment,
  datasourceMissing = false,
  stagedHoldoutId = null,
  fieldAction = null,
}: {
  experiment: ExperimentInterfaceStringDates;
  datasourceMissing?: boolean;
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
  const { getDatasourceById } = useDefinitions();
  // The Analysis Plan's staged changes, until they're saved.
  const [datasourceId] = useStagedState(
    "analysis-plan:datasource",
    experiment.datasource || "",
  );
  const [exposureQueryId] = useStagedState(
    "analysis-plan:exposureQueryId",
    experiment.exposureQueryId || "",
  );
  const [identifierType] = useStagedState(
    "analysis-plan:exposureQueryIdentifierType",
    experiment.exposureQueryIdentifierType || "",
  );
  const datasource = getDatasourceById(datasourceId);
  const deletedDatasource =
    datasourceMissing && datasourceId === experiment.datasource;
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (q) => q.id === exposureQueryId,
  );
  const isHoldout = experiment.type === "holdout";

  return (
    <Flex direction="column" gap="3">
      {!isHoldout && (
        <Metadata
          size="sm"
          stacked
          label="Experiment key"
          action={fieldAction?.("trackingKey")}
          value={experiment.trackingKey || <EmptyValue />}
        />
      )}
      <Metadata
        size="sm"
        stacked
        label="Data Source"
        value={
          datasourceId ? (
            datasource?.name ||
            (deletedDatasource ? <em>Deleted</em> : <RestrictedValue />)
          ) : (
            <EmptyValue />
          )
        }
      />
      {datasourceId ? (
        <Metadata
          size="sm"
          stacked
          label="Assignment query"
          value={
            exposureQueryId ? (
              (exposureQuery?.name ??
              (datasource || deletedDatasource ? (
                <em>Not found</em>
              ) : (
                <RestrictedValue />
              )))
            ) : (
              <EmptyValue />
            )
          }
        />
      ) : null}
      {/* A table with one identifier type implies it. */}
      {exposureQuery &&
      getExposureQueryIdentifierTypes(exposureQuery).length > 1 ? (
        <Metadata
          size="sm"
          stacked
          label="Identifier type"
          value={resolveAnalysisIdentifierType(
            exposureQuery,
            identifierType || undefined,
          )}
        />
      ) : null}
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
          action={fieldAction?.("project")}
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
    </Flex>
  );
}

export function ExperimentStatusField({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const statusIndicator = useExperimentStatusIndicator()(experiment);
  const statusDetail = statusIndicator.detailedStatus;
  const result =
    experiment.status === "stopped" && statusDetail
      ? experiment.results
      : undefined;

  return (
    <Metadata
      size="sm"
      stacked
      label="Status"
      value={
        <Flex align="baseline" gap={result ? "2" : "1"}>
          <Text size="sm" color="text-high">
            {statusIndicator.status}
          </Text>
          {result ? (
            <ResultsIndicator results={result} size="xs" />
          ) : statusDetail ? (
            <Text size="sm" color="text-mid">
              · {statusDetail}
            </Text>
          ) : null}
        </Flex>
      }
    />
  );
}

export function ExperimentDates({
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
  const duration = runLength(started, ended || new Date());
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
