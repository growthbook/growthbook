import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { ApiInterleavingInterface } from "shared/validators";
import { getMetricLink } from "shared/experiments";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import DataList, { DataListItem } from "@/ui/DataList";
import Markdown from "@/components/Markdown/Markdown";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import InterleavingVariationsInput from "./InterleavingVariationsInput";
import { rankersOf } from "./EditInterleavingRankersModal";

const EMPTY = <Text color="text-mid">--</Text>;

function OverviewSection({
  title,
  description,
  onEdit,
  children,
}: {
  title: string;
  description?: string;
  onEdit?: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <Frame>
      <Flex align="start" justify="between" mb="3" gap="3">
        <Box>
          <Heading as="h4" size="sm" mb="0">
            {title}
          </Heading>
          {description && (
            <Text as="div" size="sm" color="text-low">
              {description}
            </Text>
          )}
        </Box>
        {onEdit ? (
          <Button variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </Flex>
      {children}
    </Frame>
  );
}

export default function InterleavingOverview({
  interleaving: il,
  canEdit,
  editDescription,
  editEnvironments,
  editRankers,
  editTargeting,
  editAnalysis,
}: {
  interleaving: ApiInterleavingInterface;
  canEdit: boolean;
  editDescription?: () => void;
  editEnvironments?: () => void;
  editRankers?: () => void;
  editTargeting?: () => void;
  editAnalysis?: () => void;
}) {
  const environments = useEnvironments();
  const { getDatasourceById, getExperimentMetricById } = useDefinitions();
  const { exposureQueries } = useInterleavingExposureQueries(il.datasource);

  const exposureQuery = exposureQueries.find(
    (q) => q.id === il.interleavingExposureQueryId,
  );

  const environmentItems: DataListItem[] = environments.map((env) => ({
    label: env.id,
    value: il.environmentSettings[env.id]?.enabled ? "On" : "Off",
  }));

  const targetingItems: DataListItem[] = [
    { label: "Hash Attribute", value: il.hashAttribute || EMPTY },
    {
      label: "Coverage",
      value: `${Math.round((il.coverage ?? 1) * 100)}% included`,
    },
    {
      label: "Attribute Targeting",
      value: il.condition ? (
        <ConditionDisplay condition={il.condition} />
      ) : (
        EMPTY
      ),
    },
    {
      label: "Saved Group Targeting",
      value: il.savedGroups?.length ? (
        <SavedGroupTargetingDisplay savedGroups={il.savedGroups} />
      ) : (
        EMPTY
      ),
    },
    {
      label: "Prerequisite Targeting",
      value: il.prerequisites?.length ? (
        <ConditionDisplay prerequisites={il.prerequisites} />
      ) : (
        EMPTY
      ),
    },
  ];

  const analysisItems: DataListItem[] = [
    { label: "Tracking Key", value: il.trackingKey || EMPTY },
    {
      label: "Data Source",
      value: getDatasourceById(il.datasource)?.name || il.datasource || EMPTY,
    },
    {
      label: "Interleaving Exposure Query",
      value: exposureQuery?.name || il.interleavingExposureQueryId || EMPTY,
    },
    { label: "Identifier Type", value: il.userIdType || EMPTY },
    {
      label: "Metrics",
      value: il.metrics.length ? (
        <ul className="list-unstyled mb-0">
          {il.metrics.map((m) => (
            <li key={m.id}>
              <Link href={getMetricLink(m.id)}>
                {getExperimentMetricById(m.id)?.name ?? m.id}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        EMPTY
      ),
    },
  ];

  return (
    <Box>
      <OverviewSection
        title="Description"
        onEdit={canEdit ? editDescription : undefined}
      >
        {il.description ? (
          <Markdown>{il.description}</Markdown>
        ) : (
          <Text color="text-mid">
            <em>
              Add context about this interleaving experiment for your team
            </em>
          </Text>
        )}
      </OverviewSection>

      <OverviewSection title="Environments" onEdit={editEnvironments}>
        <Box mb="3">
          <DataList
            maxColumns={3}
            data={[
              {
                label: "Key",
                tooltip:
                  "Pass this to interleave() in your code. It can't be changed.",
                value: il.key,
              },
            ]}
          />
        </Box>
        <DataList maxColumns={3} data={environmentItems} />
      </OverviewSection>

      <OverviewSection title="Rankers" onEdit={editRankers}>
        <InterleavingVariationsInput
          value={rankersOf(il)}
          setValue={() => undefined}
          jsonSchema={il.jsonSchema}
          disabled
        />
      </OverviewSection>

      <OverviewSection
        title="Targeting"
        description="Which units to include in interleaving at all."
        onEdit={editTargeting}
      >
        <DataList maxColumns={3} data={targetingItems} />
      </OverviewSection>

      <OverviewSection title="Analysis" onEdit={editAnalysis}>
        <DataList maxColumns={3} data={analysisItems} />
      </OverviewSection>
    </Box>
  );
}
