import { MetricExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useMemo } from "react";
import { getValidDate } from "shared/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { BlockProps } from ".";

export default function MetricExplorerBlock({
  block: { visualizationType, valueType, analysisSettings },
  metricAnalysis,
  factMetric,
}: BlockProps<MetricExplorerBlockInterface>) {
  const { getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const formatterOptions = useMemo(
    () => ({ currency: displayCurrency }),
    [displayCurrency],
  );

  const _chartData = useMemo(() => {
    const data: { x: string | number | Date; y: number }[] = [];

    const rawFormatter = getExperimentMetricFormatter(
      factMetric,
      getFactTableById,
      valueType === "sum" ? "number" : "percentage",
    );
    const formatter = (value: number) => rawFormatter(value, formatterOptions);

    const rows = (metricAnalysis.result?.dates || [])
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
      factMetric.metricType === "mean"
    ) {
      metricAnalysis.result?.histogram?.forEach((row) => {
        data.push({
          x: `${formatter(row.start)} - ${formatter(row.end)}`,
          y: row.units,
        });
      });
    } else if (visualizationType === "timeseries") {
      rows.forEach((row) => {
        if (valueType === "sum" && factMetric.metricType !== "ratio") {
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
        text: `${factMetric.name}`,
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
    factMetric,
    valueType,
    visualizationType,
    metricAnalysis,
    analysisSettings.startDate,
    analysisSettings.endDate,
    textColor,
    formatterOptions,
    getFactTableById,
  ]);

  return <div></div>;
}
