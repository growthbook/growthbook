import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { getRequiredColumnsForPipelineSettings } from "shared/enterprise";
import cloneDeep from "lodash/cloneDeep";
import { FactTableInterface } from "back-end/types/fact-table";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import EditFactTableSQLModal from "@/components/FactTables/EditFactTableSQLModal";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  onSaveDataSource: (ds: DataSourceInterfaceWithParams) => Promise<void>;
};

type ValidationStatus = {
  id: string;
  status: "pending" | "done";
  missingColumns: string[];
  error?: string;
};

const PipelineQueriesValidationStep = ({
  dataSource,
  onSaveDataSource,
}: Props) => {
  const { apiCall } = useAuth();
  const { factTables, mutateDefinitions } = useDefinitions();

  const dataSourceExposureQueries = useMemo(
    () => dataSource.settings?.queries?.exposure || [],
    [dataSource.settings?.queries?.exposure],
  );
  const dataSourceFactTables = factTables.filter(
    (t) => t.datasource === dataSource.id,
  );

  const queriesToValidate = useMemo(() => {
    const exposure = dataSourceExposureQueries.map((q, idx) => ({
      kind: "exposure" as const,
      id: q.id,
      name: q.name,
      sql: q.query,
      index: idx,
    }));
    const facts = dataSourceFactTables.map((t) => ({
      kind: "fact" as const,
      id: t.id,
      name: t.name || t.id,
      sql: t.sql,
      table: t,
    }));
    return [...exposure, ...facts];
  }, [dataSourceExposureQueries, dataSourceFactTables]);

  const [validationById, setValidationById] = useState<
    Record<string, ValidationStatus>
  >({
    ...queriesToValidate.reduce(
      (acc, q) => ({
        ...acc,
        [q.id]: {
          id: q.id,
          status: "pending",
          missingColumns: [],
        },
      }),
      {},
    ),
  });

  const requiredColumns = useMemo(() => {
    if (!dataSource.settings.pipelineSettings) return [];
    return getRequiredColumnsForPipelineSettings(
      dataSource.settings.pipelineSettings,
    );
  }, [dataSource.settings.pipelineSettings]);

  const [editExposureSqlIdx, setEditExposureSqlIdx] = useState<number | null>(
    null,
  );
  const [editFactTable, setEditFactTable] = useState<
    FactTableInterface | undefined
  >(undefined);

  const validateByIds = useCallback(
    async (ids: string[]): Promise<Record<string, ValidationStatus>> => {
      if (!ids.length) return {};
      try {
        const res = await apiCall<{
          status: number;
          queryResults: {
            id: string;
            columnsFound?: string[];
            missingColumns?: string[];
            error?: string;
          }[];
        }>(`/datasource/${dataSource.id}/pipeline/validate-queries`, {
          method: "POST",
          body: JSON.stringify({ queryIds: ids }),
        });
        const map: Record<string, ValidationStatus> = {};
        (res.queryResults || []).forEach((r) => {
          map[r.id] = {
            id: r.id,
            missingColumns: r.missingColumns || [],
            error: r.error,
            status: "done",
          };
        });
        return map;
      } catch (e) {
        const map: Record<string, ValidationStatus> = {};
        ids.forEach((id) => {
          map[id] = {
            id,
            missingColumns: [],
            error: "message" in e ? e.message : String(e),
            status: "done",
          };
        });
        return map;
      }
    },
    [apiCall, dataSource.id],
  );

  const validateAll = useCallback(async () => {
    setValidationById((prev) => {
      const keys = Object.keys(prev);
      return keys.reduce(
        (acc, id) => ({
          ...acc,
          [id]: {
            ...prev[id],
            status: "pending",
          },
        }),
        {},
      );
    });

    const map = await validateByIds(queriesToValidate.map((q) => q.id));
    setValidationById((prev) => {
      const keys = Object.keys(prev);
      return keys.reduce(
        (acc, id) => ({
          ...acc,
          [id]: {
            ...prev[id],
            status: "done",
            missingColumns: map[id]?.missingColumns || [],
            error: map[id]?.error,
          },
        }),
        {},
      );
    });
  }, [validateByIds, queriesToValidate]);

  const validateSingle = useCallback(
    async (id: string) => {
      setValidationById((prev) => {
        return {
          ...prev,
          [id]: {
            ...prev[id],
            status: "pending",
          },
        };
      });

      const map = await validateByIds([id]);
      setValidationById((prev) => {
        return {
          ...prev,
          [id]: {
            ...prev[id],
            ...map[id],
            status: "done",
            missingColumns: map[id]?.missingColumns || [],
            error: map[id]?.error,
          },
        };
      });
    },
    [validateByIds],
  );

  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    validateAll();
  }, [mounted, validateAll]);

  return (
    <Box>
      <Box mb="3">
        <Callout status="info">
          To take full advantage of Pipeline mode and minimize how much data is
          scanned, update the Exposure Queries and Fact Tables below to include
          the partition columns you specified.
          {requiredColumns.length > 0 && (
            <>
              <div className="mt-2">
                <Text size="2" weight="medium">
                  Partition columns:
                </Text>
              </div>
              <div className="mt-1">
                {requiredColumns.map((c) => (
                  <code key={`top-${c}`} className="mr-2 border p-1">
                    {c}
                  </code>
                ))}
              </div>
            </>
          )}
        </Callout>
      </Box>

      <Flex align="center" mb="2" gap="3">
        <Button
          className="btn-sm btn-secondary"
          onClick={() => {
            validateAll();
          }}
          type="button"
          disabled={Object.values(validationById).some(
            (v) => v.status === "pending",
          )}
        >
          {Object.values(validationById).some((v) => v.status === "pending")
            ? "Checking..."
            : "Re-check All"}
        </Button>
        <Flex align="center" gap="2">
          <Badge
            label={String(dataSourceExposureQueries.length)}
            color="gray"
            radius="medium"
          />
          <Text size="2">Exposure Queries</Text>
        </Flex>
        <Flex align="center" gap="2">
          <Badge
            label={String(dataSourceFactTables.length)}
            color="gray"
            radius="medium"
          />
          <Text size="2">Fact Tables</Text>
        </Flex>
      </Flex>

      <Box asChild>
        <ul className="mb-0" style={{ paddingLeft: 20 }}>
          {queriesToValidate.map((item) => {
            const status = validationById[item.id];
            const missing = status?.missingColumns || [];
            const hasError = !!status?.error;
            const pending = status?.status === "pending";
            return (
              <li key={`${item.kind}-${item.id}`} style={{ marginBottom: 6 }}>
                <Flex align="center" justify="between">
                  <Text size="2" weight="medium">
                    {item.kind === "exposure"
                      ? "Exposure query: "
                      : "Fact Table: "}
                    {item.name}
                  </Text>
                  <Flex align="center" gap="3">
                    <Text
                      size="2"
                      color={
                        pending
                          ? "gray"
                          : hasError || missing.length
                            ? "red"
                            : "green"
                      }
                    >
                      {pending
                        ? "Checking..."
                        : hasError
                          ? `Error testing query`
                          : missing.length
                            ? `Missing columns: ${missing.join(", ")}`
                            : "Ready"}
                    </Text>
                    {item.kind === "exposure" ? (
                      <Button
                        className="btn-sm btn-secondary"
                        onClick={() => setEditExposureSqlIdx(item.index)}
                        type="button"
                      >
                        Edit SQL
                      </Button>
                    ) : (
                      <Button
                        className="btn-sm btn-secondary"
                        onClick={() =>
                          setEditFactTable(item.table as FactTableInterface)
                        }
                        type="button"
                      >
                        Edit SQL
                      </Button>
                    )}
                  </Flex>
                </Flex>
              </li>
            );
          })}
        </ul>
      </Box>

      {editExposureSqlIdx !== null && (
        <EditSqlModal
          close={() => setEditExposureSqlIdx(null)}
          datasourceId={dataSource.id}
          requiredColumns={new Set<string>(requiredColumns)}
          value={dataSourceExposureQueries[editExposureSqlIdx]?.query || ""}
          save={async (sql: string) => {
            const copy = cloneDeep(dataSource);
            copy.settings!.queries!.exposure![editExposureSqlIdx].query = sql;
            await onSaveDataSource(copy);
            setEditExposureSqlIdx(null);
            await validateSingle(
              dataSourceExposureQueries[editExposureSqlIdx].id,
            );
          }}
        />
      )}

      {editFactTable && (
        <EditFactTableSQLModal
          close={() => setEditFactTable(undefined)}
          factTable={editFactTable}
          requiredColumns={new Set<string>(requiredColumns)}
          save={async (data) => {
            await apiCall(`/fact-tables/${editFactTable.id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
            await mutateDefinitions();
            setEditFactTable(undefined);
            await validateSingle(editFactTable.id);
          }}
        />
      )}
    </Box>
  );
};

export default PipelineQueriesValidationStep;
