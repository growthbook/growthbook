import { ReactNode, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { QaOverrideFilters } from "shared/types/experiment-qa-override";
import { qaOverrideFiltersAreEmpty, qaOverrideHasCondition } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  QaOverrideNameLookups,
  summarizeQaOverrideFilters,
} from "@/services/qaOverrides";
import ConditionDisplay, {
  operatorToText,
} from "@/components/Features/ConditionDisplay";
import { PlainEntityBadge } from "@/components/Features/EntityBadge";
import Badge from "@/ui/Badge";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";

type NamedConnection = { id: string; name: string };

/**
 * Display names for ids in filters. `connections` lets a page that already
 * fetched the relevant SDK connections (the experiment endpoint returns the
 * ones the viewer may see) avoid a second request; anything missing falls
 * back to the org-wide list.
 */
export function useQaOverrideNameLookups(
  connections?: NamedConnection[],
): QaOverrideNameLookups {
  const { getSavedGroupById, getProjectById } = useDefinitions();
  const { data: connectionData } = useSDKConnections();
  return useMemo(
    () => ({
      savedGroupName: (id) => getSavedGroupById(id)?.groupName ?? id,
      projectName: (id) => getProjectById(id)?.name ?? id,
      sdkConnectionName: (id) =>
        connections?.find((c) => c.id === id)?.name ??
        connectionData?.connections?.find((c) => c.id === id)?.name ??
        id,
      operatorText: (operator) => operatorToText({ operator }),
    }),
    [connections, connectionData, getProjectById, getSavedGroupById],
  );
}

/** Every filter spelled out, for the "+N" / "Custom condition" popover. */
function FullFilters({
  filters,
  lookups,
}: {
  filters: QaOverrideFilters;
  lookups: QaOverrideNameLookups;
}) {
  const names = (ids: string[] | undefined, name: (id: string) => string) =>
    (ids ?? []).map(name).join(", ");
  return (
    <Flex direction="column" gap="3" style={{ maxWidth: 420 }}>
      <Flex align="baseline" gap="2">
        <Text weight="semibold">Filters</Text>
        <Text size="sm" color="text-low">
          (All must match)
        </Text>
      </Flex>
      {qaOverrideHasCondition(filters) && (
        <Metadata
          stacked
          label="Attribute"
          value={<ConditionDisplay condition={filters.condition} />}
        />
      )}
      {!!filters.savedGroups?.length && (
        <Metadata
          stacked
          label="Group"
          value={<ConditionDisplay savedGroups={filters.savedGroups} />}
        />
      )}
      {!!filters.sdkConnections?.length && (
        <Metadata
          stacked
          label="SDK Connection"
          value={names(filters.sdkConnections, lookups.sdkConnectionName)}
        />
      )}
      {!!filters.projects?.length && (
        <Metadata
          stacked
          label="Project"
          value={names(filters.projects, lookups.projectName)}
        />
      )}
    </Flex>
  );
}

/**
 * Filters as a short row of chips, with the overflow behind a "+N" chip that
 * shows everything on hover. No filters reads as "Everyone".
 */
export default function QaOverrideFilterChips({
  filters,
  lookups,
}: {
  filters: QaOverrideFilters;
  lookups: QaOverrideNameLookups;
}) {
  if (qaOverrideFiltersAreEmpty(filters)) {
    return <Text color="text-mid">Everyone</Text>;
  }
  const { visible, hidden } = summarizeQaOverrideFilters(filters, lookups);
  const full = <FullFilters filters={filters} lookups={lookups} />;
  const hoverable = (node: ReactNode) => (
    <Popover
      openOnHover
      side="top"
      align="start"
      trigger={
        <span tabIndex={0} style={{ display: "inline-flex", cursor: "help" }}>
          {node}
        </span>
      }
      content={full}
    />
  );
  return (
    <Flex align="center" gap="1" wrap="wrap">
      {visible.map((chip, i) =>
        chip.custom ? (
          <span key={i}>
            {hoverable(<PlainEntityBadge label={chip.label} maxWidth={180} />)}
          </span>
        ) : (
          <PlainEntityBadge key={i} label={chip.label} maxWidth={180} />
        ),
      )}
      {hidden > 0 &&
        hoverable(<Badge label={`+${hidden}`} color="gray" variant="soft" />)}
    </Flex>
  );
}
