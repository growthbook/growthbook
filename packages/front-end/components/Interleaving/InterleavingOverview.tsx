import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
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
import Badge from "@/ui/Badge";
import { INTERLEAVING_ANALYSIS_TITLES } from "@/services/interleaving";
import Markdown from "@/components/Markdown/Markdown";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import InterleavingRankersDisplay from "./InterleavingRankersDisplay";

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
            <Trans>Edit</Trans>
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
  const { t, i18n } = useLingui();
  const environments = useEnvironments();
  const { getDatasourceById, getExperimentMetricById } = useDefinitions();
  const { exposureQueries } = useInterleavingExposureQueries(il.datasourceId);

  const exposureQuery = exposureQueries.find(
    (q) => q.id === il.interleavingExposureQueryId,
  );

  const environmentItems: DataListItem[] = environments.map((env) => ({
    label: env.id,
    value: il.environmentSettings[env.id]?.enabled ? t`On` : t`Off`,
  }));

  const coveragePercent = Math.round((il.coverage ?? 1) * 100);
  const targetingItems: DataListItem[] = [
    { label: t`Hash attribute`, value: il.hashAttribute || EMPTY },
    {
      label: t`Coverage`,
      value: t`${coveragePercent}% included`,
    },
    {
      label: t`Attribute Targeting`,
      value: il.condition ? (
        <ConditionDisplay condition={il.condition} />
      ) : (
        EMPTY
      ),
    },
    {
      label: t`Saved Group Targeting`,
      value: il.savedGroups?.length ? (
        <SavedGroupTargetingDisplay savedGroups={il.savedGroups} />
      ) : (
        EMPTY
      ),
    },
    {
      label: t`Prerequisite Targeting`,
      value: il.prerequisites?.length ? (
        <ConditionDisplay prerequisites={il.prerequisites} />
      ) : (
        EMPTY
      ),
    },
  ];

  const analysisItems: DataListItem[] = [
    { label: t`Tracking key`, value: il.trackingKey || EMPTY },
    {
      label: t`Data Source`,
      value:
        getDatasourceById(il.datasourceId)?.name || il.datasourceId || EMPTY,
    },
    {
      label: t`Interleaving Exposure Query`,
      value: exposureQuery?.name || il.interleavingExposureQueryId || EMPTY,
    },
    { label: t`Identifier type`, value: il.userIdType || EMPTY },
    {
      label: t`Metrics`,
      value: il.metrics.length ? (
        <Flex direction="column" gap="2">
          {il.metrics.map((m) => (
            <Flex key={m.id} align="center" gap="2" wrap="wrap">
              <Link href={getMetricLink(m.id)}>
                {getExperimentMetricById(m.id)?.name ?? m.id}
              </Link>
              {m.analyses.map((a) => (
                <Badge
                  key={a.type}
                  label={i18n._(INTERLEAVING_ANALYSIS_TITLES[a.type])}
                  color="violet"
                  variant="soft"
                  size="sm"
                />
              ))}
            </Flex>
          ))}
        </Flex>
      ) : (
        EMPTY
      ),
    },
  ];

  return (
    <Box>
      <OverviewSection
        title={t`Description`}
        onEdit={canEdit ? editDescription : undefined}
      >
        {il.description ? (
          <Markdown>{il.description}</Markdown>
        ) : (
          <Text color="text-mid">
            <em>
              <Trans>
                Add context about this interleaving experiment for your team
              </Trans>
            </em>
          </Text>
        )}
      </OverviewSection>

      <OverviewSection title={t`Environments`} onEdit={editEnvironments}>
        <Box mb="3">
          <DataList
            maxColumns={3}
            data={[
              {
                label: t`Key`,
                tooltip: t`Pass this to interleave() in your code. It can't be changed.`,
                value: il.key,
              },
            ]}
          />
        </Box>
        <DataList maxColumns={3} data={environmentItems} />
      </OverviewSection>

      <OverviewSection title={t`Rankers`} onEdit={editRankers}>
        <InterleavingRankersDisplay
          variations={il.variations}
          jsonSchema={il.jsonSchema}
        />
      </OverviewSection>

      <OverviewSection
        title={t`Targeting`}
        description={t`Which units to include in interleaving at all.`}
        onEdit={editTargeting}
      >
        <DataList maxColumns={3} data={targetingItems} />
      </OverviewSection>

      <OverviewSection title={t`Analysis`} onEdit={editAnalysis}>
        <DataList maxColumns={3} data={analysisItems} />
      </OverviewSection>
    </Box>
  );
}
