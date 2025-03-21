import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import useApi from "@/hooks/useApi";
import { formatNumber } from "@/services/metrics";
import ExperimentDateGraph from "@/components/Experiment/ExperimentDateGraph";

const TimeSeriesTest = (): React.ReactElement => {
  const { data } = useApi<{ timeSeries: MetricTimeSeries[] }>(`/time-series`);

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

  const timeSeries = data.timeSeries;

  return (
    <div>
      {timeSeries.map((t) => {
        return (
          <div key={t.id}>
            {t.source}-{t.sourceId}-{t.metricId}
            <ExperimentDateGraph
              yaxis="effect"
              label="Something"
              variationNames={t.dataPoints[0].variations.map((v) => v.name)}
              datapoints={t.dataPoints.map((r) => {
                return {
                  d: new Date(r.date),
                  variations: r.variations.map((i) => {
                    return {
                      v: i[type]?.value ?? 0,
                      v_formatted: `${i[type]?.value ?? 0}`,
                      users: i[type]?.denominator,
                      p: i[type]?.pValue ?? undefined,
                      ctw: i[type]?.chanceToWin ?? undefined,
                      ci: i[type]?.ci ?? undefined,
                    };
                  }),
                };
              })}
              formatter={formatNumber}
            />
          </div>
        );
      })}
    </div>
  );
};

export default TimeSeriesTest;
