import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { OrganizationSettings } from "shared/types/organization";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  isProjectListValidForProject,
  isManagedWarehouseUnavailable,
  getActiveFeatureUsageQuery,
} from "shared/util";
import { FeatureEvalDiagnosticsQueryResponseRows } from "shared/types/integrations";
import { QueryStatistics } from "shared/types/query";
import { Box, Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { format } from "date-fns";
import { isNull } from "lodash";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import LinkButton from "@/ui/LinkButton";
import { useAddComputedFields, useSearch } from "@/services/search";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import EmptyState from "@/components/EmptyState";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/ui/Table";
import Field from "@/components/Forms/Field";

type FeatureEvaluationDiagnosticsQueryResults = {
  rows?: FeatureEvalDiagnosticsQueryResponseRows;
  statistics?: QueryStatistics;
  error?: string;
  sql?: string;
};

// Helper function to format a value for display
const formatDisplayValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  } else if (value === undefined) {
    return "undefined";
  } else if (typeof value === "boolean") {
    return String(value);
  } else if (typeof value === "object") {
    return JSON.stringify(value);
  } else {
    return String(value);
  }
};

function getDatasourceInitialFormValue(
  datasources: DataSourceInterfaceWithParams[],
  settings: OrganizationSettings,
  project?: string,
): { datasourceId: string } {
  const validDatasources = datasources.filter((d) =>
    isProjectListValidForProject(d.projects, project),
  );

  if (!validDatasources.length) return { datasourceId: "" };

  // Default to the first datasource with a feature usage query or managed warehouse.
  // If none found, fall back to the org default datasource.
  const initialId =
    validDatasources.find(
      (d) =>
        (d.type === "growthbook_clickhouse" &&
          !isManagedWarehouseUnavailable(d)) ||
        getActiveFeatureUsageQuery(d.settings?.queries?.featureUsage),
    )?.id || settings.defaultDataSource;

  const initialDatasource =
    (initialId && validDatasources.find((d) => d.id === initialId)) ||
    validDatasources[0];

  return {
    datasourceId: initialDatasource.id,
  };
}

export default function FeatureDiagnostics({
  feature,
  results,
  setResults,
}: {
  feature: FeatureInterface;
  results: Array<
    FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
  > | null;
  setResults: (
    results: Array<
      FeatureEvalDiagnosticsQueryResponseRows[number] & { id: string }
    > | null,
  ) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { datasources, getDatasourceById } = useDefinitions();
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const validDatasources = useMemo(() => {
    return datasources.filter((d) => {
      if (!isProjectListValidForProject(d.projects, feature.project))
        return false;
      return true;
    });
  }, [datasources, feature.project]);

  const form = useForm({
    defaultValues: {
      ...getDatasourceInitialFormValue(
        validDatasources,
        settings,
        feature.project,
      ),
    },
  });

  const datasourceId = form.watch("datasourceId");
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  const awaitingProvisioning = datasource
    ? isManagedWarehouseUnavailable(datasource)
    : false;

  // Managed warehouse natively supports diagnostics via its feature_usage table.
  // Event forwarder and regular datasources need a configured feature usage query.
  const datasourceHasFeatureUsageQuery =
    datasource &&
    !awaitingProvisioning &&
    (datasource.type === "growthbook_clickhouse" ||
      !!getActiveFeatureUsageQuery(datasource.settings?.queries?.featureUsage));

  // Extract all unique keys from results
  const columns = useMemo(() => {
    if (results === null || results.length === 0) return [];
    const keysSet = new Set<string>();
    // Only iterate over the first row since all rows have the same structure
    Object.keys(results[0]).forEach((key) => {
      if (key !== "id" && key !== "timestamp" && key !== "feature_key") {
        keysSet.add(key);
      }
    });

    return Array.from(keysSet);
  }, [results]);

  const evalItems = useAddComputedFields(
    results ?? [],
    (row) => {
      const timestampDate = getValidDate(row.timestamp);
      // Compute display values for all columns
      const displayValues: Record<string, string> = {};
      columns.forEach((key) => {
        displayValues[key] = formatDisplayValue(row[key]);
      });

      return {
        timestamp: format(timestampDate, "PPpp"),
        timestampSort: timestampDate.getTime(),
        ...displayValues,
      } as {
        timestamp: string;
        timestampSort: number;
      } & Record<string, string | number>;
    },
    [results, columns],
  );

  const { items, pagination, SortableTH, searchInputProps } = useSearch({
    items: evalItems,
    defaultSortField: "timestampSort",
    defaultSortDir: -1,
    localStorageKey: "feature-diagnostics-v2",
    searchFields: ["timestamp", ...columns],
    pageSize: 25,
  });

  const onRunFeatureUsageQuery = async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await apiCall<FeatureEvaluationDiagnosticsQueryResults>(
        "/query/feature-eval-diagnostic",
        {
          method: "POST",
          body: JSON.stringify({
            feature: feature.id,
            datasourceId: form.watch("datasourceId"),
          }),
        },
      );
      if (results.rows) {
        const rowsWithId = results.rows.map((row, index) => ({
          ...row,
          id: index.toString(),
        }));
        setResults(rowsWithId);
      } else {
        setResults([]);
      }
      if (results.error) {
        setError(results.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Empty State: Prompt user to set up a data source to view diagnostics for this feature
  if (validDatasources.length === 0) {
    return (
      <Box className="contents container-fluid pagecontents">
        <EmptyState
          title="Feature Evaluation Diagnostics"
          description="Set up a data source to view diagnostics for this feature."
          leftButton={
            <LinkButton href="/datasources">Set up a Data Source</LinkButton>
          }
          rightButton={null}
        />
      </Box>
    );
  }

  return (
    <Box className="contents container-fluid pagecontents">
      <p>
        View recent feature evaluations along with any custom metadata
        you&apos;ve added.
      </p>

      <Box width="400px">
        <SelectField
          label="Select a Data Source"
          labelClassName="font-weight-bold"
          value={form.watch("datasourceId") ?? ""}
          onChange={(newDatasource) => {
            if (newDatasource !== form.watch("datasourceId")) {
              setResults(null);
              form.setValue("datasourceId", newDatasource);
            }
          }}
          options={validDatasources.map((d) => {
            const isDefaultDataSource = d.id === settings.defaultDataSource;
            return {
              value: d.id,
              label: `${d.name}${
                d.description ? ` — ${d.description}` : ""
              }${isDefaultDataSource ? " (default)" : ""}`,
            };
          })}
          className="portal-overflow-ellipsis"
        />
      </Box>

      {datasource && awaitingProvisioning && (
        <ManagedWarehouseNoEventsCallout />
      )}

      {datasource &&
        !awaitingProvisioning &&
        !datasourceHasFeatureUsageQuery && (
          <Callout status="info" mb="4">
            Feature Evaluation Diagnostics require setting up a feature usage
            query in your data source.
            <Link href={`/datasources/${datasource.id}`} ml="2">
              Setup a Feature Usage Query
            </Link>
          </Callout>
        )}

      {datasource && datasourceHasFeatureUsageQuery && (
        <Frame mt="4">
          {isNull(results) ? (
            <Flex justify="center">
              <Button
                onClick={onRunFeatureUsageQuery}
                disabled={loading || !datasourceHasFeatureUsageQuery}
                size="md"
              >
                {loading
                  ? "Running..."
                  : !results
                    ? "View recent feature evaluations"
                    : "Refresh feature evaluations"}
              </Button>
            </Flex>
          ) : (
            <Flex direction="row" justify="between" my="3">
              <Box flexBasis="40%" flexShrink="1" flexGrow="0">
                <Field
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
              </Box>

              <Button
                onClick={onRunFeatureUsageQuery}
                disabled={loading || !datasourceHasFeatureUsageQuery}
              >
                {loading ? "Running..." : "Refresh feature evaluations"}
              </Button>
            </Flex>
          )}
          {error && (
            <Callout status="error" my="3">
              <strong>Error:</strong> {error}
            </Callout>
          )}
          {results && results.length === 0 && (
            <Callout status="info" my="3">
              No feature evaluations found.
            </Callout>
          )}

          {items.length > 0 && (
            <>
              <Table mt="6" className="table gbtable responsive-table">
                <TableHeader>
                  <TableRow>
                    <SortableTH field="timestampSort">Timestamp</SortableTH>
                    {columns.map((key) => (
                      <SortableTH key={key} field={key}>
                        {key
                          .split("_")
                          .map(
                            (word) =>
                              word.charAt(0).toUpperCase() +
                              word.slice(1).toLowerCase(),
                          )
                          .join(" ")}
                      </SortableTH>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.timestamp}</TableCell>
                      {columns.map((key) => (
                        <TableCell key={key}>{row[key]}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pagination}
            </>
          )}
        </Frame>
      )}
    </Box>
  );
}
