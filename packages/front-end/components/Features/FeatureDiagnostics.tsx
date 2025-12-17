import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { OrganizationSettings } from "back-end/types/organization";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { isProjectListValidForProject } from "shared/util";
import { FeatureEvalDiagnosticsQueryResponseRows } from "shared/types/integrations";
import { QueryStatistics } from "back-end/types/query";
import { Box, Flex } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { format } from "date-fns";
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
import Tooltip from "@/ui/Tooltip";
import EmptyState from "@/components/EmptyState";

type FeatureEvaluationDiagnosticsQueryResults = {
  rows?: FeatureEvalDiagnosticsQueryResponseRows;
  statistics?: QueryStatistics;
  error?: string;
  sql?: string;
};

// Helper function to format a value for display
const formatDisplayValue = (value: unknown): string => {
  if (value === null) {
    return "";
  } else if (value === undefined) {
    return "";
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

  // Default to the first datasource with a feature usage query
  // If no datasource with a feature usage query is found, default to the default datasource
  const initialId =
    validDatasources.find(
      (d) =>
        d.settings.queries?.featureUsage &&
        d.settings.queries?.featureUsage.length > 0,
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
    >,
  ) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { datasources, getDatasourceById } = useDefinitions();
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const validDatasources = useMemo(() => {
    return datasources.filter((d) =>
      isProjectListValidForProject(d.projects, feature.project),
    );
  }, [datasources, feature.project]);

  const form = useForm({
    defaultValues: {
      ...getDatasourceInitialFormValue(datasources, settings, feature.project),
    },
  });

  const datasourceId = form.watch("datasourceId");
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  const datasourceHasFeatureUsageQuery =
    datasource &&
    datasource.settings.queries?.featureUsage &&
    datasource.settings.queries.featureUsage.length > 0;

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
      // Compute display values for all columns
      const displayValues: Record<string, string> = {};
      columns.forEach((key) => {
        displayValues[key] = formatDisplayValue(row[key]);
      });

      return {
        timestamp: format(getValidDate(row.timestamp), "PPpp"),
        ...displayValues,
      };
    },
    [results, columns],
  );

  const { items, pagination, SortableTH } = useSearch({
    items: evalItems,
    defaultSortField: "timestamp",
    defaultSortDir: -1,
    localStorageKey: "feature-diagnostics",
    searchFields: ["timestamp", ...columns],
    pageSize: 50,
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
        // add an id to each row based on the timestamp
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
      <h2>Feature Evaluation Diagnostics</h2>
      <p>
        View recent feature evaluations along with any custom metadata
        you&apos;ve added.
      </p>

      {datasource && !datasourceHasFeatureUsageQuery && (
        <Callout status="info" mb="4">
          Feature Evaluation Diagnostics require setting up a feature usage
          query in your data source.
          <Link href={`/datasources/${datasource.id}`} ml="2">
            Setup a Feature Usage Query
          </Link>
        </Callout>
      )}
      <Box width="400px">
        <SelectField
          label="Select a Data Source"
          labelClassName="font-weight-bold"
          value={form.watch("datasourceId") ?? ""}
          onChange={(newDatasource) => {
            form.setValue("datasourceId", newDatasource);
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

      <Frame mt="4">
        <Flex direction="row" justify="end" mb="4">
          <Tooltip
            content="Setup a feature usage query in your data source to view feature evaluations."
            enabled={!datasourceHasFeatureUsageQuery && !loading}
          >
            <Button
              onClick={onRunFeatureUsageQuery}
              disabled={loading || !datasourceHasFeatureUsageQuery}
            >
              {loading
                ? "Running..."
                : !results
                  ? "View recent feature evaluations"
                  : "Refresh feature evaluations"}
            </Button>
          </Tooltip>
        </Flex>
        {error && (
          <Callout status="error">
            <strong>Error:</strong> {error}
          </Callout>
        )}
        {results && results.length === 0 && (
          <Callout status="info">No feature evaluations found.</Callout>
        )}
        {/* If there's feature usage data, show a table with the data */}
        {items.length > 0 && (
          <>
            <table className="table experiment-table gbtable">
              <thead>
                <tr>
                  <SortableTH field="timestamp">Timestamp</SortableTH>
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
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>{format(getValidDate(row.timestamp), "PPpp")}</td>
                    {columns.map((key) => (
                      <td key={key}>
                        {typeof row[key] === "string" ||
                        typeof row[key] === "number" ||
                        typeof row[key] === "boolean"
                          ? String(row[key])
                          : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {pagination}
          </>
        )}
      </Frame>
    </Box>
  );
}
