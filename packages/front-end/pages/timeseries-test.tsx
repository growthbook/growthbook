import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import { daysBetween } from "shared/dates";
import { addDays, eachDayOfInterval, subDays } from "date-fns";
import useApi from "@/hooks/useApi";
import { formatNumber } from "@/services/metrics";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "@/components/Experiment/ExperimentDateGraph";

const previousWeek = eachDayOfInterval({
  start: subDays(new Date(), 7),
  end: new Date(),
});

const TimeSeriesTest = (): React.ReactElement => {
  const { data } = useApi<{ timeSeries: MetricTimeSeries[] }>(`/time-series`);

  const renderTimeSeries = (t: MetricTimeSeries) => {
    const additionalGraphDataPoints: ExperimentDateGraphDataPoint[] = [];
    const sortedDataPoints = t.dataPoints.sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    const firstDate = sortedDataPoints[0].date;
    const lastDate = sortedDataPoints[sortedDataPoints.length - 1].date;

    const numOfDays = daysBetween(firstDate, lastDate);
    if (numOfDays < 7) {
      additionalGraphDataPoints.push({
        d: addDays(new Date(lastDate), 7 - numOfDays),
      });
    }

    // Add a test data point with helperText
    if (sortedDataPoints.length > 2) {
      // Add helperText to the middle point for testing
      sortedDataPoints[Math.floor(sortedDataPoints.length / 2)].tags = [
        "experiment-settings-changed",
      ];

      // Add helperText to one more point for testing
      if (sortedDataPoints.length > 3) {
        sortedDataPoints[Math.floor(sortedDataPoints.length * 0.75)].tags = [
          "metric-settings-changed",
        ];
      }
    }

    return (
      <div key={t.id}>
        {t.sourceId}-{t.metricId}
        <ExperimentDateGraph
          yaxis="effect"
          label="% Change"
          variationNames={t.dataPoints[0].variations.map((v) => v.name)}
          statsEngine="bayesian"
          hasStats={true}
          datapoints={[
            ...t.dataPoints.map((r) => {
              const point: ExperimentDateGraphDataPoint = {
                d: new Date(r.date),
                variations: r.variations.map((i) => {
                  return {
                    // ci: [-1.6625962930093463, 2.3292629596760124],
                    ci: i[type]?.ci ?? undefined,
                    // v: 4,
                    v: i[type]?.value ?? 0,
                    // v_formatted: "66.7%",
                    v_formatted: `${i[type]?.value ?? 0}`,
                    // users: 6,
                    users: i.stats?.users,
                    // p: 1,
                    // p: 1,
                    // ctw: 0.6282896511523738,
                    ctw: i[type]?.chanceToWin ?? undefined,
                    // up: 0.01,
                    // up: i[type]?.up ?? undefined,
                  };
                }),
              };

              if (
                r.tags?.includes("experiment-settings-changed") &&
                r.tags?.includes("metric-settings-changed")
              ) {
                point.helperText = "Experiment and metric settings changed";
              } else if (r.tags?.includes("experiment-settings-changed")) {
                point.helperText = "Experiment settings changed";
              } else if (r.tags?.includes("metric-settings-changed")) {
                point.helperText = "Metric settings changed";
              }

              return point;
            }),
            ...additionalGraphDataPoints,
          ]}
          formatter={formatNumber}
        />
      </div>
    );
  };

  if (!data) {
    return <>Loading...</>;
  }
  if (!data.timeSeries) {
    return <>Error?</>;
  }

  const differenceType = "absolute" as string;
  const type = (() => {
    switch (differenceType) {
      case "absolute":
        return "absolute";
      case "relative":
        return "relative";
      case "scaled":
        return "scaled";
      default:
        return "absolute";
    }
  })();

  return <div>{data.timeSeries.map(renderTimeSeries)}</div>;
};

export default TimeSeriesTest;
