import { Flex } from "@radix-ui/themes";
import {
  ExperimentQaOverrideInterface,
  ExperimentQaOverrideWithStatus,
} from "shared/types/experiment-qa-override";
import { ago } from "shared/dates";
import {
  QA_OVERRIDE_WAITING_REASONS,
  qaOverrideFiltersAreEmpty,
  qaOverrideHasCondition,
} from "shared/util";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";

type VariationLike = { id: string; name: string };

export function QaOverrideVariation({
  override,
  variations,
}: {
  override: ExperimentQaOverrideInterface;
  variations: VariationLike[];
}) {
  if (override.assignment.type === "random") {
    return <Text color="text-mid">Random assignment</Text>;
  }
  const { variationId } = override.assignment;
  const index = variations.findIndex((v) => v.id === variationId);
  if (index < 0) return <Text color="text-low">Unknown variation</Text>;
  return <VariationLabel number={index} name={variations[index].name} />;
}

export function QaOverrideFiltersSummary({
  override,
}: {
  override: ExperimentQaOverrideInterface;
}) {
  const { getProjectById } = useDefinitions();
  const { data: connectionData } = useSDKConnections();
  const { filters } = override;

  if (qaOverrideFiltersAreEmpty(filters)) {
    return (
      <Text color="text-mid">
        Everyone in <Text weight="medium">{override.environment}</Text>
      </Text>
    );
  }

  const connectionName = (id: string) =>
    connectionData?.connections?.find((c) => c.id === id)?.name ?? id;

  return (
    <Flex direction="column" gap="1">
      {(qaOverrideHasCondition(filters) || !!filters.savedGroups?.length) && (
        <ConditionDisplay
          condition={filters.condition}
          savedGroups={filters.savedGroups}
        />
      )}
      {!!filters.sdkConnections?.length && (
        <Flex align="center" gap="1" wrap="wrap">
          <Text size="sm" color="text-mid">
            SDK Connection{filters.sdkConnections.length === 1 ? "" : "s"}:
          </Text>
          {filters.sdkConnections.map((id) => (
            <Badge key={id} label={connectionName(id)} color="gray" />
          ))}
        </Flex>
      )}
      {!!filters.projects?.length && (
        <Flex align="center" gap="1" wrap="wrap">
          <Text size="sm" color="text-mid">
            Project{filters.projects.length === 1 ? "" : "s"}:
          </Text>
          {filters.projects.map((id) => (
            <Badge
              key={id}
              label={getProjectById(id)?.name ?? id}
              color="gray"
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}

export function QaOverrideSetBy({
  override,
}: {
  override: ExperimentQaOverrideInterface;
}) {
  const { getUserDisplay } = useUser();
  return (
    <Text color="text-mid">
      {getUserDisplay(override.createdBy, true)} · {ago(override.dateCreated)}
    </Text>
  );
}

export function QaOverrideStatusBadge({
  override,
}: {
  override: Pick<ExperimentQaOverrideWithStatus, "status" | "waitingOn">;
}) {
  if (override.status === "active") {
    return <Badge label="Active" color="green" variant="soft" />;
  }
  return (
    <Tooltip
      body={
        <Flex direction="column" gap="1">
          {override.waitingOn.map((w) => (
            <Text key={w.featureId} size="sm">
              <code>{w.featureId}</code>:{" "}
              {QA_OVERRIDE_WAITING_REASONS[w.reason]}
            </Text>
          ))}
        </Flex>
      }
    >
      <Badge label="Waiting for Feature Flag" color="amber" variant="soft" />
    </Tooltip>
  );
}
