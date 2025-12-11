import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { OrganizationSettings } from "back-end/types/organization";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { isProjectListValidForProject } from "shared/util";
import { FeatureUsageQueryResponseRows } from "shared/types/integrations";
import { QueryStatistics } from "back-end/types/query";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import LinkButton from "@/ui/LinkButton";
import { SearchFields, useSearch } from "@/services/search";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import EmptyState from "../EmptyState";

type FeatureEvaluationDiagnosticsQueryResults = {
  rows?: FeatureUsageQueryResponseRows;
  statistics?: QueryStatistics;
  error?: string;
  sql?: string;
  truncated?: boolean;
};

export function getFeatureDatasourceDefaults(
  datasources: DataSourceInterfaceWithParams[],
  settings: OrganizationSettings,
  project?: string,
  initialValue?: Partial<FeatureInterface>,
): Pick<FeatureInterface, "datasourceId"> {
  const validDatasources = datasources.filter(
    (d) =>
      d.id === initialValue?.datasourceId ||
      isProjectListValidForProject(d.projects, project),
  );

  if (!validDatasources.length) return { datasourceId: "" };

  // Default to the first datasource with a feature usage query
  // If no datasource with a feature usage query is found, default to the default datasource
  const initialId =
    initialValue?.datasourceId ||
    validDatasources.find(
      (d) =>
        d.settings.queries?.featureUsage &&
        d.settings.queries?.featureUsage.length > 0,
    )?.id ||
    settings.defaultDataSource;

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
  results: Array<FeatureUsageQueryResponseRows[number] & { id: string }> | null;
  setResults: (
    results: Array<FeatureUsageQueryResponseRows[number] & { id: string }>,
  ) => void;
}) {
  // const [openDatasourceModal, setOpenDatasourceModal] = useState(false);
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
      ...getFeatureDatasourceDefaults(
        datasources,
        settings,
        feature.project,
        feature,
      ),
    },
  });

  const datasourceId = form.watch("datasourceId");
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  const datasourceHasFeatureUsageQuery =
    datasource &&
    datasource.settings.queries?.featureUsage &&
    datasource.settings.queries.featureUsage.length > 0;

  // Extract all unique keys from results (excluding 'id' which is added internally)
  const columns = useMemo(() => {
    if (results === null || results.length === 0)
      return ["timestamp", "feature_key"];
    const keysSet = new Set<string>();
    // Only iterate over the first row since all rows have the same structure
    Object.keys(results[0]).forEach((key) => {
      if (key !== "id" && key !== "timestamp" && key !== "feature_key") {
        keysSet.add(key);
      }
    });
    // Ensure timestamp and feature_key are first
    const priorityKeys = ["timestamp", "feature_key"];
    return [...priorityKeys, ...Array.from(keysSet)];
  }, [results]);

  const { items, pagination, SortableTH } = useSearch({
    items: results ?? [],
    defaultSortField: "timestamp",
    defaultSortDir: -1,
    localStorageKey: "feature-diagnostics",
    searchFields: columns as SearchFields<
      FeatureUsageQueryResponseRows[number]
    >,
    pageSize: 100,
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
        const rowsWithId = results.rows.map((row) => ({
          ...row,
          id: row.timestamp ?? "",
        }));
        setResults(rowsWithId);
      } else {
        setResults([]);
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
                    {columns.map((key) => (
                      <td key={key}>
                        {JSON.stringify(row[key as keyof typeof row])}
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
