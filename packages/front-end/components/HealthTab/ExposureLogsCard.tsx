import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  isManagedWarehouse,
  isManagedWarehousePendingQueryError,
  isManagedWarehouseUnavailable,
} from "shared/util";
import type { ExperimentExposureRecord } from "shared/validators";
import { getLatestPhaseVariations } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import RecordsPanel from "@/components/Diagnostics/RecordsPanel";
import useRecordsQuery from "@/components/Diagnostics/useRecordsQuery";
import { formatTimestamp, truncate } from "@/components/Diagnostics/format";
import {
  RecordsColumn,
  RecordsFilterOption,
} from "@/components/Diagnostics/types";
import { datasourcesWithoutHealthData } from "./constants";

interface ExposuresResponse {
  records: ExperimentExposureRecord[];
  dimensions: string[];
  extraColumns: string[];
  hasMore: boolean;
  sql?: string;
  error?: string;
  cached?: boolean;
  ranAt?: string;
}

function Empty() {
  return (
    <Text size="sm" color="text-low">
      —
    </Text>
  );
}

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  isTabActive: boolean;
}

export default function ExposureLogsCard({ experiment, isTabActive }: Props) {
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const datasource = getDatasourceById(experiment.datasource);
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );
  const dimensions = useMemo(
    () => exposureQuery?.dimensions ?? [],
    [exposureQuery?.dimensions],
  );

  const canRun =
    !!datasource &&
    !datasourcesWithoutHealthData.has(datasource.type) &&
    !isManagedWarehouseUnavailable(datasource) &&
    !!exposureQuery &&
    permissionsUtil.canRunHealthQueries(datasource);

  // GrowthBook owns the compute for a managed warehouse, so results can be
  // fetched on sight. A customer's warehouse bills them per query, so it waits
  // for an explicit Update.
  const autoRun = !!datasource && isManagedWarehouse(datasource);

  const filterKeys = useMemo(
    () => ["user", "variation", ...dimensions],
    [dimensions],
  );

  const query = useRecordsQuery<ExperimentExposureRecord, ExposuresResponse>({
    endpoint: `/experiment/${experiment.id}/exposures`,
    filterKeys,
    canRun,
    autoRun,
    isActive: isTabActive,
    selectRows: (data) => data.records,
    buildParams: ({ startDate, endDate, page, searchTerm, getFilterValue }) => {
      const dimensionFilters: Record<string, string> = {};
      for (const dim of dimensions) {
        const value = getFilterValue(dim);
        if (value) dimensionFilters[dim] = value;
      }
      return {
        startDate,
        endDate,
        page: String(page),
        // Bare search text is treated as a user id, matching the event log.
        userId: getFilterValue("user") || searchTerm || undefined,
        variationId: getFilterValue("variation") || undefined,
        dimensionFilters: Object.keys(dimensionFilters).length
          ? JSON.stringify(dimensionFilters)
          : undefined,
      };
    },
  });

  // Indexed off the latest phase so the number matches the traffic card legend.
  // The warehouse returns v.key when variation keys are configured, and the
  // positional index otherwise.
  const variationsById = useMemo(() => {
    const byId = new Map<string, { index: number; name: string }>();
    getLatestPhaseVariations(experiment).forEach((v) => {
      const entry = { index: v.index, name: v.name || `Variation ${v.index}` };
      byId.set(v.key || String(v.index), entry);
      byId.set(String(v.index), entry);
    });
    return byId;
  }, [experiment]);

  const columns: RecordsColumn<ExperimentExposureRecord>[] = useMemo(
    () => [
      {
        key: "timestamp",
        header: "Timestamp",
        render: (r) => (
          <Text size="sm" mono>
            {formatTimestamp(r.timestamp)}
          </Text>
        ),
      },
      {
        key: "userId",
        header: "User ID",
        render: (r) =>
          r.userId ? (
            <Text size="sm" mono title={r.userId}>
              {truncate(r.userId, 24)}
            </Text>
          ) : (
            <Empty />
          ),
      },
      {
        key: "variationId",
        header: "Variation",
        render: (r) => {
          // An id the experiment no longer defines is shown raw, so it is not
          // mistaken for a real variation.
          const variation = variationsById.get(r.variationId);
          return variation ? (
            <VariationLabel
              number={variation.index}
              name={variation.name}
              size="sm"
            />
          ) : (
            <Text size="sm" mono>
              {r.variationId}
            </Text>
          );
        },
      },
      ...dimensions.map((dim) => ({
        key: dim,
        header: dim,
        render: (r: ExperimentExposureRecord) =>
          r.dimensions[dim] ? <>{r.dimensions[dim]}</> : <Empty />,
      })),
    ],
    [dimensions, variationsById],
  );

  const filterOptions = useMemo(() => {
    const options: Record<string, RecordsFilterOption[]> = {
      // The menu carries the same label as the column; the token stays the id.
      variation: getLatestPhaseVariations(experiment).map((v) => ({
        name: (
          <VariationLabel
            number={v.index}
            name={v.name || `Variation ${v.index}`}
            size="sm"
          />
        ),
        id: v.key || String(v.index),
        searchValue: v.key || String(v.index),
      })),
    };
    // Dimension values aren't enumerable up front, so offer what this page has.
    for (const dim of dimensions) {
      const seen = new Set<string>();
      for (const r of query.rows) {
        const value = r.dimensions[dim];
        if (value) seen.add(value);
      }
      options[dim] = Array.from(seen)
        .sort()
        .map((value) => ({ name: value, id: value, searchValue: value }));
    }
    return options;
  }, [experiment, dimensions, query.rows]);

  if (!canRun) return null;

  // The managed warehouse reports "still provisioning / no events yet" as a
  // query error; that deserves the onboarding callout, not a red error.
  const queryError = query.data?.error;
  const warning = isManagedWarehousePendingQueryError(queryError) ? (
    <ManagedWarehouseNoEventsCallout />
  ) : queryError ? (
    <Callout status="warning" size="sm">
      {queryError}
    </Callout>
  ) : null;

  return (
    <RecordsPanel
      title="Exposure Logs"
      query={query}
      columns={columns}
      getRowId={(r, i) =>
        `${r.timestamp}-${r.userId ?? ""}-${r.variationId}-${i}`
      }
      detailFlattenKeys={["dimensions", "extra"]}
      detailTitle="Full exposure record"
      hasNextPage={!!query.data?.hasMore}
      lastUpdated={query.data?.ranAt}
      searchPlaceholder={`Search... (user:id variation:0${
        dimensions.length > 0 ? ` ${dimensions[0]}:value` : ""
      })`}
      filterOptions={filterOptions}
      filterOrder={["variation", ...dimensions]}
      filterLabels={{ variation: "Variation" }}
      emptyMessage="No exposures found for this time range."
      idleMessage="Press Enter or click Update to load exposure records."
      warning={warning}
    />
  );
}
