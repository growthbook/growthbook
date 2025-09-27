import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "back-end/types/metric-analysis";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { PiWrench } from "react-icons/pi";
import EChartsReact from "echarts-for-react";
import { ago, getValidDate } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Select, SelectItem } from "@/ui/Select";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useCurrency } from "@/hooks/useCurrency";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import { Panel, PanelGroup, PanelResizeHandle } from "../ResizablePanels";
import BigValueChart from "../SqlExplorer/BigValueChart";
import MetricSelector from "../Experiment/MetricSelector";
import PopulationChooser from "../MetricAnalysis/PopulationChooser";

type MetricExplorerSettings = {
  metricId: string;
  analysisSettings: MetricAnalysisSettings;
  visualizationType: "bigNumber" | "timeseries" | "histogram";
  valueType: "sum" | "avg";
};

export function MetricExplorer() {
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 30);
  const form = useForm<MetricExplorerSettings>({
    defaultValues: {
      analysisSettings: {
        lookbackDays: 30,
        startDate: defaultStart,
        endDate: new Date(),
        populationId: "",
        populationType: "factTable",
        userIdType: "",
      },
      metricId: "",
      visualizationType: "timeseries",
      valueType: "avg",
    },
  });

  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";

  const displayCurrency = useCurrency();
  const formatterOptions = useMemo(
    () => ({ currency: displayCurrency }),
    [displayCurrency],
  );

  const { apiCall } = useAuth();

  const [results, setResults] = useState<MetricAnalysisInterface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const [analysisId, setAnalysisId] = useState<string | null>(null);

  const { getFactMetricById, getFactTableById, project } = useDefinitions();

  const updateResults = async () => {
    const { metricId, analysisSettings, visualizationType } = form.getValues();

    setError(null);

    if (!metricId || !analysisSettings.userIdType) return;

    setLoading(true);
    try {
      const response = await apiCall<{
        metricAnalysis: MetricAnalysisInterface | null;
      }>(
        `/metric-analysis/metric/${metricId}?settings=${encodeURIComponent(JSON.stringify(analysisSettings))}&withHistogram=${visualizationType === "histogram"}`,
        {
          method: "GET",
        },
      );

      setResults(response.metricAnalysis);
      setAnalysisId(response.metricAnalysis?.id || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (
      analysisId &&
      (results?.status === "running" || results?.status === "queued")
    ) {
      const timeout = setInterval(async () => {
        const res = await apiCall<{
          metricAnalysis: MetricAnalysisInterface;
        }>(`/metric-analysis/${analysisId}`, {
          method: "GET",
        });
        setResults(res.metricAnalysis);
      }, 3000);
      return () => clearInterval(timeout);
    }
  }, [analysisId, results?.status, apiCall]);

  const refreshResults = async () => {
    const { metricId, analysisSettings } = form.getValues();
    if (!metricId || !analysisSettings.userIdType) return;

    const body: CreateMetricAnalysisProps = {
      id: metricId,
      userIdType: analysisSettings.userIdType,
      lookbackDays: analysisSettings.lookbackDays,
      startDate: analysisSettings.startDate.toISOString(),
      endDate: analysisSettings.endDate.toISOString(),
      populationType: analysisSettings.populationType,
      populationId: analysisSettings.populationId || null,
      source: "metric",
    };

    setError(null);
    setLoading(true);
    try {
      const response = await apiCall<{
        metricAnalysis: MetricAnalysisInterface;
      }>(`/metric-analysis`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      setResults(response.metricAnalysis);
      setAnalysisId(response.metricAnalysis.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const analysisSettings = form.watch("analysisSettings");
  const visualizationType = form.watch("visualizationType");
  const valueType = form.watch("valueType");

  const metric = getFactMetricById(form.watch("metricId"));
  const factTable = getFactTableById(metric?.numerator?.factTableId || "");

  const chartData = useMemo(() => {
    if (!metric) return null;
    if (!results) return null;

    const data: { x: string | number | Date; y: number }[] = [];

    const rawFormatter = getExperimentMetricFormatter(
      metric,
      getFactTableById,
      valueType === "sum" ? "number" : "percentage",
    );
    const formatter = (value: number) => rawFormatter(value, formatterOptions);

    const rows = (results.result?.dates || [])
      .map((r) => {
        return { ...r, date: getValidDate(r.date) };
      })
      .filter((d) => {
        if (d.date < analysisSettings.startDate) return false;
        if (d.date > analysisSettings.endDate) return false;
        return true;
      });

    if (visualizationType === "bigNumber") {
      const sum = rows.reduce((acc, curr) => {
        const value =
          valueType === "avg" ? curr.mean || 0 : curr.mean * (curr.units || 0);
        return acc + value;
      }, 0);

      return {
        value: valueType === "sum" ? sum : sum / (rows.length || 1),
        formatter,
      };
    } else if (
      visualizationType === "histogram" &&
      metric.metricType === "mean"
    ) {
      results.result?.histogram?.forEach((row) => {
        data.push({
          x: `${formatter(row.start)} - ${formatter(row.end)}`,
          y: row.units,
        });
      });
    } else if (visualizationType === "timeseries") {
      rows.forEach((row) => {
        if (valueType === "sum" && metric.metricType !== "ratio") {
          data.push({ x: row.date, y: (row.mean || 0) * (row.units || 0) });
        } else {
          data.push({
            x: row.date,
            y: row.mean || 0,
          });
        }
      });
    }

    const option = {
      title: {
        text: `${metric.name}`,
        left: "center",
        textStyle: {
          color: textColor,
          fontSize: 20,
          fontWeight: "bold",
        },
      },
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
      },
      xAxis: {
        type: visualizationType === "timeseries" ? "time" : "category",
        nameLocation: "middle",
        nameTextStyle: {
          fontSize: 14,
          fontWeight: "bold",
          padding: [10, 0],
          color: textColor,
        },
        axisLabel: {
          color: textColor,
        },
      },
      yAxis: {
        type: "value",
        nameLocation: "middle",
        nameTextStyle: {
          fontSize: 14,
          fontWeight: "bold",
          padding: [40, 0],
          color: textColor,
        },
        axisLabel: {
          color: textColor,
          formatter: visualizationType !== "histogram" ? formatter : undefined,
        },
      },
      dataset: [
        {
          source: data,
        },
      ],
      series: [
        {
          type: visualizationType === "histogram" ? "bar" : "line",
          encode: {
            x: "x",
            y: "y",
          },
        },
      ],
    };
    return option;
  }, [
    metric,
    valueType,
    visualizationType,
    results,
    analysisSettings.startDate,
    analysisSettings.endDate,
    textColor,
    formatterOptions,
    getFactTableById,
  ]);

  return (
    <PanelGroup direction="horizontal">
      <Panel
        id="graph"
        order={1}
        defaultSize={75}
        minSize={55}
        style={{ position: "relative" }}
      >
        <AreaWithHeader
          header={
            <Flex align="center" width="100%">
              <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
                Results
              </Text>
              <Box flexGrow={"1"} />
              {results?.dateCreated && (
                <Text style={{ color: "var(--color-text-muted)" }} size="1">
                  {ago(results.dateCreated)}
                </Text>
              )}
              <Button
                onClick={refreshResults}
                ml="4"
                loading={
                  loading ||
                  ["running", "queued"].includes(results?.status || "")
                }
              >
                Refresh
              </Button>
              <MoreMenu>
                {results?.queries?.length ? (
                  <ViewAsyncQueriesButton
                    queries={results.queries.map((q) => q.query)}
                    color={results?.status === "error" ? "danger" : "info"}
                    error={results?.error}
                    className="dropdown-item py-2"
                  />
                ) : null}
              </MoreMenu>
            </Flex>
          }
        >
          <Box p="4">
            {error ? (
              <Callout status="error">{error}</Callout>
            ) : loading ? (
              <LoadingOverlay />
            ) : !results ? (
              <Box p="4" style={{ textAlign: "center" }}>
                <Text
                  style={{ color: "var(--color-text-mid)", fontWeight: 500 }}
                >
                  No cached data available. Refresh to see results.
                </Text>
              </Box>
            ) : results.status === "error" ? (
              <Callout status="error">
                {results.error || "There was an error with the analysis"}
              </Callout>
            ) : ["running", "queued"].includes(results.status || "") ? (
              <LoadingOverlay />
            ) : visualizationType === "bigNumber" ? (
              <BigValueChart
                value={
                  (chartData && "value" in chartData && chartData.value) || 0
                }
                label={"Value"}
                formatter={
                  (chartData as { formatter: (value: number) => string })
                    .formatter
                }
              />
            ) : (
              <EChartsReact
                key={JSON.stringify(chartData)}
                option={chartData}
                style={{ width: "100%", minHeight: "450px", height: "80%" }}
              />
            )}
          </Box>
        </AreaWithHeader>
      </Panel>
      <PanelResizeHandle />
      <Panel id="graph-config" order={2} defaultSize={25} minSize={20}>
        <Box style={{ overflow: "auto", height: "100%" }}>
          <Flex direction="column" gap="4">
            <AreaWithHeader
              header={
                <Text
                  style={{ color: "var(--color-text-mid)", fontWeight: 500 }}
                >
                  <Flex align="center" gap="1">
                    <PiWrench style={{ color: "var(--violet-11)" }} size={20} />
                    Configuration
                  </Flex>
                </Text>
              }
            >
              <Box p="4" height="fit-content">
                <Flex direction="column" gap="4">
                  <MetricSelector
                    label="Metric"
                    labelClassName="font-weight-bold"
                    value={form.watch("metricId")}
                    project={project}
                    includeFacts={true}
                    containerClassName="mb-0"
                    filterMetrics={(m) => {
                      // Only fact metrics
                      const metric = getFactMetricById(m.id);
                      if (!metric) return false;

                      // Skip quantile and retention metrics
                      if (
                        metric.metricType === "quantile" ||
                        metric.metricType === "retention"
                      ) {
                        return false;
                      }

                      return true;
                    }}
                    onChange={(value) => {
                      const newMetric = getFactMetricById(value);

                      if (!newMetric) return;

                      form.setValue("metricId", value);

                      // Only mean metric support histogram views
                      if (
                        newMetric.metricType !== "mean" &&
                        visualizationType === "histogram"
                      ) {
                        form.setValue("visualizationType", "timeseries");
                      }

                      if (
                        newMetric.metricType === "ratio" &&
                        valueType === "sum"
                      ) {
                        form.setValue("valueType", "avg");
                      }

                      // If switching to a different fact table, reset user ID type and population
                      if (
                        newMetric.numerator?.factTableId !==
                        metric?.numerator?.factTableId
                      ) {
                        const newFactTable = getFactTableById(
                          newMetric.numerator?.factTableId || "",
                        );
                        const newAnalysisSettings: MetricAnalysisSettings = {
                          ...analysisSettings,
                          populationType: "factTable",
                          populationId: "",
                        };

                        // Only reset userIdType if it's no longer valid
                        if (
                          !newFactTable ||
                          !newFactTable.userIdTypes.includes(
                            analysisSettings.userIdType,
                          )
                        ) {
                          newAnalysisSettings.userIdType = "";
                        }

                        form.setValue("analysisSettings", newAnalysisSettings);
                      }

                      updateResults();
                    }}
                  />

                  {metric && factTable && (
                    <Select
                      label="Unit"
                      size="2"
                      value={analysisSettings.userIdType}
                      placeholder="Select unit"
                      setValue={(v) => {
                        form.setValue("analysisSettings", {
                          ...analysisSettings,
                          userIdType: v,
                          populationType: "factTable",
                          populationId: "",
                        });

                        updateResults();
                      }}
                    >
                      {factTable.userIdTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </Select>
                  )}

                  {metric && factTable && (
                    <PopulationChooser
                      datasourceId={factTable.datasource}
                      value={analysisSettings.populationType ?? "factTable"}
                      setValue={(v, populationId) => {
                        form.setValue("analysisSettings", {
                          ...analysisSettings,
                          populationId,
                          populationType: v,
                        });

                        updateResults();
                      }}
                      userIdType={analysisSettings.userIdType}
                      newStyle
                    />
                  )}

                  {metric && metric?.metricType !== "ratio" && (
                    <Select
                      label="Metric Value"
                      size="2"
                      value={valueType}
                      placeholder="Select value"
                      setValue={(v) => {
                        form.setValue("valueType", v as "sum" | "avg");
                      }}
                    >
                      <SelectItem value="avg">
                        {metric?.metricType === "proportion"
                          ? "Proportion"
                          : "Average"}
                      </SelectItem>
                      <SelectItem value="sum">
                        {metric?.metricType === "proportion"
                          ? "Unit Count"
                          : "Sum"}
                      </SelectItem>
                    </Select>
                  )}

                  <Select
                    label="Date Range"
                    size="2"
                    value={analysisSettings.lookbackDays + ""}
                    placeholder="Select value"
                    setValue={(v) => {
                      const days = parseInt(v);

                      // Calculate start/end
                      const start = new Date();
                      const end = new Date();
                      start.setDate(end.getDate() - days);

                      form.setValue("analysisSettings", {
                        ...analysisSettings,
                        lookbackDays: days,
                        startDate: start,
                        endDate: end,
                      });

                      updateResults();
                    }}
                  >
                    <SelectItem value="7">Last 7 Days</SelectItem>
                    <SelectItem value="14">Last 14 Days</SelectItem>
                    <SelectItem value="30">Last 30 Days</SelectItem>
                    <SelectItem value="90">Last 90 Days</SelectItem>
                    <SelectItem value="180">Last 180 Days</SelectItem>
                    <SelectItem value="365">Last 365 Days</SelectItem>
                    <SelectItem value="9999">Last 9999 Days</SelectItem>
                  </Select>

                  <Select
                    label="Graph Type"
                    size="2"
                    value={visualizationType}
                    placeholder="Select value"
                    setValue={(v) => {
                      form.setValue(
                        "visualizationType",
                        v as "bigNumber" | "timeseries" | "histogram",
                      );
                      updateResults();
                    }}
                  >
                    <SelectItem value="bigNumber">Big Number</SelectItem>
                    <SelectItem value="timeseries">Timeseries</SelectItem>
                    {metric?.metricType === "mean" && (
                      <SelectItem value="histogram">Histogram</SelectItem>
                    )}
                  </Select>
                </Flex>
              </Box>
            </AreaWithHeader>
          </Flex>
        </Box>
      </Panel>
    </PanelGroup>
  );
}
