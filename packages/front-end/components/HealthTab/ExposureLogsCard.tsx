import { useCallback, useMemo } from "react";
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
import { RecordsColumn } from "@/components/Diagnostics/types";
import type { FilterColumnSource } from "@/components/FactTables/rowFilterUtils";
import { datasourcesWithoutHealthData } from "./constants";

interface ExposuresResponse {
  records: ExperimentExposureRecord[];
  dimensions: string[];
  extraColumns: string[];
  truncated: boolean;
  sql?: string;
  error?: string;
  cached?: boolean;
  ranAt?: string;
}

const VARIATION_COLUMN = "variation_id";
const TIMESTAMP_COLUMN = "timestamp";
const DEFAULT_USER_ID_COLUMN = "user_id";

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
  const userIdColumn = exposureQuery?.userIdType || DEFAULT_USER_ID_COLUMN;

  const canRun =
    !!datasource &&
    !datasourcesWithoutHealthData.has(datasource.type) &&
    !isManagedWarehouseUnavailable(datasource) &&
    !!exposureQuery &&
    permissionsUtil.canRunHealthQueries(datasource);

  // GrowthBook owns the compute for a managed warehouse, so results can be
  // fetched on sight. A customer's warehouse bills them per query, so it waits
  // for an explicit Refresh.
  const autoRun = !!datasource && isManagedWarehouse(datasource);

  const query = useRecordsQuery<ExperimentExposureRecord, ExposuresResponse>({
    endpoint: `/experiment/${experiment.id}/exposures`,
    canRun,
    autoRun,
    isActive: isTabActive,
    selectRows: (data) => data.records,
    buildParams: ({ startDate, endDate, rowFilters }) => ({
      startDate,
      endDate,
      rowFilters,
    }),
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

  // A filter names the warehouse column, because that is what the query has to
  // emit; the panel shows the friendlier column header instead.
  const getFilterValue = useCallback(
    (row: ExperimentExposureRecord, column: string) => {
      if (column === TIMESTAMP_COLUMN) return row.timestamp;
      if (column === userIdColumn) return row.userId;
      if (column === VARIATION_COLUMN) return row.variationId;
      return row.dimensions[column];
    },
    [userIdColumn],
  );

  const getSearchText = useCallback(
    (row: ExperimentExposureRecord) =>
      [
        row.timestamp,
        row.userId ?? "",
        row.variationId,
        ...Object.values(row.dimensions).map((v) => v ?? ""),
      ].join(" "),
    [],
  );

  // Dimension values aren't enumerable up front, so offer the ones this buffer
  // actually holds — the same values the table is showing.
  const columnSource: FilterColumnSource = useMemo(() => {
    const columnLabels: [string, string][] = [
      [userIdColumn, userIdColumn],
      [VARIATION_COLUMN, "Variation"],
      ...dimensions.map((d): [string, string] => [d, d]),
    ];

    const topValues = new Map<string, string[]>();
    topValues.set(
      VARIATION_COLUMN,
      getLatestPhaseVariations(experiment).map((v) => v.key || String(v.index)),
    );
    for (const dim of dimensions) {
      const seen = new Set<string>();
      for (const row of query.rows) {
        const value = row.dimensions[dim];
        if (value) seen.add(value);
      }
      topValues.set(dim, Array.from(seen).sort());
    }

    return {
      columns: columnLabels.map(([value, label]) => ({ label, value })),
      savedFilters: [],
      getColumnInfo: (column) => ({
        // Every value is coerced to a string by shapeExposureRows, so the
        // string operator set is the honest one to offer.
        datatype: column ? "string" : "",
        topValues: (column && topValues.get(column)) || [],
      }),
    };
  }, [dimensions, experiment, query.rows, userIdColumn]);

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
      getSearchText={getSearchText}
      getFilterValue={getFilterValue}
      columnSource={columnSource}
      detailFlattenKeys={["dimensions", "extra"]}
      detailTitle="Full exposure record"
      lastUpdated={query.data?.ranAt}
      truncated={query.data?.truncated}
      searchPlaceholder="Search exposures..."
      emptyMessage="No exposures found for this time range."
      idleMessage="Click Refresh to load exposure records."
      warning={warning}
    />
  );
}
