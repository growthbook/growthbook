import { useForm } from "react-hook-form";
import { UserExperimentExposuresQueryResponseRows } from "shared/types/integrations";
import { QueryStatistics } from "shared/types/query";
import { useEffect, useState } from "react";
import { datetime } from "shared/dates";
import { getLatestPhaseVariations } from "shared/experiments";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import LoadingSpinner from "@/components/LoadingSpinner";
import SelectField from "@/components/Forms/SelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import { useExperiments } from "@/hooks/useExperiments";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";

type UserExposureQueryResults = {
  rows?: UserExperimentExposuresQueryResponseRows;
  experimentMap?: Map<string, string>;
  statistics?: QueryStatistics;
  error?: string;
  sql?: string;
  truncated?: boolean;
};

const ExposureDebuggerPage = () => {
  const { defaultDataSource } = useOrgSettings();
  const { datasources, getDatasourceById } = useDefinitions();
  const form = useForm({
    defaultValues: {
      datasourceId: defaultDataSource ?? "",
      unitId: "",
      userIdType: "",
      lookbackDays: "7",
    },
  });
  const { apiCall } = useAuth();
  const [results, setResults] = useState<UserExposureQueryResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { experimentsMap } = useExperiments();
  const datasourceId = form.watch("datasourceId");
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  // If the userIdType is no longer valid, reset it to the first valid one
  useEffect(() => {
    if (
      !datasource?.settings?.userIdTypes?.find(
        (t) => t.userIdType === form.watch("userIdType"),
      )
    ) {
      form.setValue(
        "userIdType",
        datasource?.settings?.userIdTypes?.[0]?.userIdType ?? "",
      );
    }
  }, [form, datasource]);

  const onSubmit = form.handleSubmit(async (value) => {
    setLoading(true);
    setError(null);
    try {
      const results = await apiCall<UserExposureQueryResults>(
        "/query/user-exposures",
        {
          method: "POST",
          body: JSON.stringify({
            ...value,
            lookbackDays: parseInt(value.lookbackDays),
          }),
        },
      );
      if (results.rows) {
        // add an id to each row based on the experiment_id (which is really the experiment tracking key)
        results.rows = results.rows.map((row) => ({
          ...row,
          id: results.experimentMap?.[row.experiment_id] ?? "",
        }));
      }
      setResults(results);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  });

  // Get dynamic columns from the first row (excluding timestamp, experiment_id, variation_id, and id)
  const getDynamicColumns = () => {
    if (!results?.rows || results.rows.length === 0) return [];
    const firstRow = results.rows[0];
    return Object.keys(firstRow).filter(
      (key) =>
        !["timestamp", "experiment_id", "variation_id", "id"].includes(key),
    );
  };

  const dynamicColumns = getDynamicColumns();

  return (
    <div className="contents container-fluid pagecontents">
      <div className="row">
        <div className="col-12">
          <h1>Exposures Debugger</h1>
          <p className="text-muted">
            Query experiment exposures for a specific id within a window.
          </p>
        </div>
      </div>

      <div className="appbox p-4">
        <form onSubmit={onSubmit}>
          <div className="row">
            <div className="col-md-4">
              <SelectField
                label="Select a Data Source"
                labelClassName="font-weight-bold"
                value={datasourceId ?? ""}
                onChange={(newDatasource) => {
                  form.setValue("datasourceId", newDatasource);
                }}
                options={datasources.map((d) => {
                  const isDefaultDataSource = d.id === defaultDataSource;
                  return {
                    value: d.id,
                    label: `${d.name}${
                      d.description ? ` — ${d.description}` : ""
                    }${isDefaultDataSource ? " (default)" : ""}`,
                  };
                })}
                className="portal-overflow-ellipsis mb-0"
              />
            </div>
          </div>

          {datasourceId && (
            <>
              <hr className="mt-2 mb-4" />

              <div className="row align-items-center">
                <div className="col-sm-2">
                  <SelectField
                    required
                    placeholder="Select identifier..."
                    value={form.watch("userIdType")}
                    onChange={(v) => form.setValue("userIdType", v)}
                    options={(
                      datasources.find((d) => d.id === datasourceId)?.settings
                        ?.userIdTypes || []
                    ).map((t) => {
                      return {
                        label: t.userIdType,
                        value: t.userIdType,
                      };
                    })}
                  />
                </div>

                <div className="col-md-4">
                  <Field
                    placeholder="Enter an ID"
                    {...form.register("unitId", { required: true })}
                    error={
                      form.formState.errors.unitId && "Unit ID is required"
                    }
                    markRequired
                  />
                </div>

                <div className="col-sm-2">
                  <SelectField
                    labelClassName="font-weight-bold"
                    value={form.watch("lookbackDays") ?? ""}
                    onChange={(value) => form.setValue("lookbackDays", value)}
                    options={[
                      { value: "7", label: "Last 7 days" },
                      { value: "30", label: "Last 30 days" },
                      { value: "90", label: "Last 90 days" },
                      { value: "365", label: "Last year" },
                    ]}
                    sort={false}
                    required
                  />
                </div>

                <div className="col-sm-2">
                  <Button onClick={onSubmit} disabled={loading}>
                    Query
                  </Button>
                </div>
              </div>
            </>
          )}
        </form>

        <div className="mt-4">
          {loading && (
            <div className="d-flex justify-content-center my-4">
              <LoadingSpinner className="mr-2" /> Loading...
            </div>
          )}
          {error && (
            <Callout status="error">
              <strong>Error:</strong> {error}
            </Callout>
          )}
          {results && !loading && (
            <div>
              {results.rows && results.rows.length > 0 ? (
                <>
                  <div className="mb-3">
                    <strong>Found {results.rows.length} exposure(s)</strong>
                    {results.statistics && (
                      <div className="text-muted small">
                        Query executed in{" "}
                        {results.statistics.executionDurationMs}ms
                      </div>
                    )}
                    {results.truncated && (
                      <Callout status="warning">
                        Row limit reached. Only showing the most recent
                        exposures.
                      </Callout>
                    )}
                  </div>

                  <div className="table-responsive">
                    <table className="table gbtable">
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Experiment</th>
                          <th>Variation</th>
                          <th>Variation Key</th>
                          {dynamicColumns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.rows.map((row, index) => {
                          const exp = row.id
                            ? experimentsMap.get(row.id)
                            : null;
                          const expVariations = exp
                            ? getLatestPhaseVariations(exp)
                            : [];
                          const variationIndex = expVariations.findIndex(
                            (v) => v.key === row.variation_id,
                          );
                          const variation =
                            variationIndex >= 0
                              ? expVariations[variationIndex]
                              : null;
                          return (
                            <tr key={index}>
                              <td>{datetime(row.timestamp)}</td>
                              <td>
                                <Link href={`/experiment/${row.id}`}>
                                  {row.experiment_id}
                                </Link>
                              </td>
                              <td>
                                {variation ? (
                                  <div
                                    className={`variation variation${variationIndex} with-variation-label d-flex align-items-center`}
                                  >
                                    <span
                                      className="label"
                                      style={{
                                        width: 20,
                                        height: 20,
                                        flex: "none",
                                      }}
                                    >
                                      {variationIndex}
                                    </span>
                                    <span
                                      className="d-inline-block"
                                      style={{
                                        lineHeight: "14px",
                                      }}
                                    >
                                      {variation.name}
                                    </span>
                                  </div>
                                ) : (
                                  <span>
                                    {row.variation_id}{" "}
                                    <Tooltip body="Variation key not found in the experiment" />
                                  </span>
                                )}
                              </td>
                              <td>{row.variation_id}</td>
                              {dynamicColumns.map((column) => (
                                <td key={column}>{row[column] || "--"}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Callout status="info">
                  No exposures found for the given parameters.
                </Callout>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExposureDebuggerPage;
