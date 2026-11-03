import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { date } from "shared/dates";
import { PiLockSimple } from "react-icons/pi";
import { HoldoutInterfaceStringDates } from "shared/validators";
import {
  getExposureQueryIdentifierTypes,
  resolveAnalysisIdentifierType,
} from "shared/util";
import Text from "@/ui/Text";
import {
  EmptyValue,
  OwnerField,
  ProjectField,
  TagsField,
} from "@/components/DetailsPanelFields";
import Tooltip from "@/components/Tooltip/Tooltip";
import UITooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
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
  return (
    <Flex direction="column" gap="3">
      <OwnerField owner={experiment.owner} action={fieldAction?.("owner")} />
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
      ) : (
        <ProjectField
          project={experiment.project}
          action={fieldAction?.("project")}
        />
      )}
      <TagsField
        tags={experiment.tags}
        type="experiments"
        action={fieldAction?.("tags")}
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
