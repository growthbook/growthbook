import { FC, useState, useEffect } from "react";
import useForm from "../../../hooks/useForm";
import MetricsSelector from "../../../components/Experiment/MetricsSelector";
import { formatConversionRate } from "../../../services/metrics";
import PercentImprovementGraph, {
  colorThemes,
} from "../../../components/Experiment/PercentImprovementGraph";
import DateRange from "../../../components/DateRange";
import useApi from "../../../hooks/useApi";
import { SegmentComparisonInterface } from "back-end/types/segment-comparison";
import LoadingOverlay from "../../../components/LoadingOverlay";
import { useRouter } from "next/router";
import { useAuth } from "../../../services/auth";
import RunQueriesButton, {
  getQueryStatus,
} from "../../../components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../../../components/Queries/ViewAsyncQueriesButton";
import { useDefinitions } from "../../../services/DefinitionsContext";
import useConfidenceLevels from "../../../hooks/useConfidenceLevels";

const colors = colorThemes.neutral;

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const SegmentComparisonPage: FC = () => {
  const router = useRouter();
  const { comparison } = router.query;
  const { data, error, mutate } = useApi<{
    comparison: SegmentComparisonInterface;
  }>(`/segments/comparison/${comparison}`);

  const {
    segments,
    ready,
    getSegmentById,
    datasources,
    getMetricById,
  } = useDefinitions();

  const [dates, setDates] = useState<{
    segment1: { from: Date; to: Date };
    segment2: { from: Date; to: Date };
  }>(null);
  const [value, inputProps, manualUpdate] = useForm<
    Partial<{
      title: string;
      datasource: string;
      metrics: string[];
      conversionWindowDays: number;
      segment1: {
        segment: string;
      };
      segment2: {
        segment: string;
        sameDateRange: boolean;
      };
    }>
  >({});
  const [loading, setLoading] = useState(false);
  const { apiCall } = useAuth();
  const [saveError, setSaveError] = useState(null);

  const { ciUpperDisplay } = useConfidenceLevels();

  useEffect(() => {
    if (data && !value.segment1) {
      const dates = {
        segment1: {
          from: new Date(data.comparison.segment1.from),
          to: new Date(data.comparison.segment1.to),
        },
        segment2: {
          from: new Date(data.comparison.segment2.from),
          to: new Date(data.comparison.segment2.to),
        },
      };
      setDates(dates);

      const value = {
        title: data.comparison.title || "",
        datasource: data.comparison.datasource || "",
        metrics: data.comparison.metrics || [],
        conversionWindowDays: data.comparison.conversionWindowDays || 3,
        segment1: {
          segment: data.comparison.segment1.segment || "",
        },
        segment2: {
          segment: data.comparison.segment2.segment || "",
          sameDateRange: !!data.comparison.segment2?.sameDateRange,
        },
      };
      manualUpdate(value);
    }
  }, [data, value.segment1]);

  if (error) {
    return (
      <div className="alert alert-danger">
        There was a problem loading the segment comparison
      </div>
    );
  }
  if (!value.segment1 || !ready) {
    return <LoadingOverlay />;
  }

  const filteredSegments = segments.filter(
    (s) => s.datasource === value.datasource
  );

  const results = data.comparison.results;

  const status = getQueryStatus(data.comparison.queries || []);

  return (
    <div className="p-3 container-fluid ">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (loading) return;
          setLoading(true);
          setSaveError(null);

          try {
            await apiCall(`/segments/comparison/${data.comparison.id}`, {
              method: "PUT",
              body: JSON.stringify({
                ...value,
                segment1: {
                  ...value.segment1,
                  ...dates.segment1,
                },
                segment2: {
                  ...value.segment2,
                  ...dates.segment2,
                },
              }),
            });
            mutate();
          } catch (e) {
            setSaveError(e.message);
          }
          setLoading(false);
        }}
      >
        <div className="row mb-3">
          <div className="col-lg-4 order-2 order-lg-1">
            <div className="card h-100">
              <div className="card-body">
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 10,
                    background: colors.left.dark,
                  }}
                />
                <h3>Segment 1</h3>
                <div className="form-group">
                  Segment
                  <select
                    className="form-control"
                    {...inputProps.segment1.segment}
                  >
                    <option value="">Choose one...</option>
                    {filteredSegments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  Date Range
                  <DateRange
                    from={dates.segment1.from}
                    to={dates.segment1.to}
                    onChange={(from: Date, to: Date) => {
                      setDates({
                        ...dates,
                        segment1: {
                          from,
                          to,
                        },
                      });
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="col-lg-4 order-1 order-lg-2">
            <div className="card h-100">
              <div className="card-body">
                <div
                  className="bg-dark"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 10,
                  }}
                />
                <h3>Comparison</h3>
                <div className="form-group">
                  Title
                  <input
                    type="text"
                    className="form-control"
                    {...inputProps.title}
                  />
                </div>
                <div className="form-group">
                  Data Source
                  <select className="form-control" {...inputProps.datasource}>
                    {datasources.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                    <option value="">Manual</option>
                  </select>
                </div>
                <div className="form-group">
                  Metrics
                  <MetricsSelector
                    selected={value.metrics}
                    onChange={(metrics) => {
                      manualUpdate({ metrics });
                    }}
                    datasource={value.datasource}
                  />
                </div>
                <div className="form-group">
                  Conversion Window
                  <div className="input-group">
                    <input
                      type="number"
                      className="form-control"
                      min="0"
                      max="360"
                      {...inputProps.conversionWindowDays}
                    />
                    <div className="input-group-append">
                      <div className="input-group-text">days</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col-lg-4 order-3">
            <div className="card h-100">
              <div className="card-body">
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 10,
                    background: colors.right.dark,
                  }}
                />
                <h3>Segment 2</h3>
                <div className="form-group">
                  Segment
                  <select
                    className="form-control"
                    {...inputProps.segment2.segment}
                  >
                    <option value="">Choose one...</option>
                    {filteredSegments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="pt-1">
                    <input
                      type="checkbox"
                      checked={!value.segment2.sameDateRange}
                      onChange={(e) => {
                        manualUpdate({
                          segment2: {
                            ...value.segment2,
                            sameDateRange: !e.target.checked,
                          },
                        });
                      }}
                    />{" "}
                    Date Range{" "}
                    <small className="text-muted">
                      (matches Segment 1 by default)
                    </small>
                  </label>
                  {!value.segment2.sameDateRange && (
                    <DateRange
                      from={dates.segment1.from}
                      to={dates.segment1.to}
                      onChange={(from: Date, to: Date) => {
                        setDates({
                          ...dates,
                          segment1: {
                            from,
                            to,
                          },
                        });
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="row justify-content-center">
          <div className="col-auto text-center">
            <RunQueriesButton
              cta="Save and Run"
              initialStatus={getQueryStatus(data.comparison.queries || [])}
              statusEndpoint={`/segments/comparison/${data.comparison.id}/status`}
              cancelEndpoint={`/segments/comparison/${data.comparison.id}/cancel`}
              onReady={() => {
                mutate();
              }}
            />
          </div>
          <div className="col-auto">
            <ViewAsyncQueriesButton
              queries={
                data.comparison.queries?.length > 0
                  ? data.comparison.queries.map((q) => q.query)
                  : []
              }
            />
          </div>
        </div>
        {status === "failed" && (
          <div className="alert alert-danger my-3">
            Error running the comparison. View Queries for more info
          </div>
        )}

        {saveError && (
          <div className="alert alert-danger">
            <pre>{saveError}</pre>
          </div>
        )}
      </form>
      {results && (
        <div className="text-center mt-3">
          <hr />
          {Object.keys(results.metrics).map((m) => {
            const segment1 = results.metrics[m].segment1;
            const segment2 = results.metrics[m].segment2;

            const t = getMetricById(m)?.type;

            const max = Math.max(
              ...segment2.buckets.map((b) => b.x).map(Math.abs)
            );
            return (
              <div key={m} className="mb-4">
                <div className="row bg-white mb-2">
                  <div className="col">
                    <h4 className="py-2 m-0">{getMetricById(m)?.name}</h4>
                  </div>
                </div>
                <div className="row">
                  <div
                    className="col-6 col-md-3 text-light py-2"
                    style={{ background: colors.left.dark }}
                  >
                    <strong>
                      {getSegmentById(value.segment1.segment)?.name}
                    </strong>
                  </div>
                  <div className="col-md-6 bg-dark text-light py-2 d-none d-md-block">
                    <strong>Percent Difference</strong>
                  </div>
                  <div
                    className="col-6 col-md-3 text-light py-2"
                    style={{ background: colors.right.dark }}
                  >
                    <strong>
                      {getSegmentById(value.segment2.segment)?.name}
                    </strong>
                  </div>
                </div>
                <div className="row">
                  <div className="col-6 col-md-3 order-1">
                    <div
                      className="pt-2 pt-md-5"
                      style={{ fontSize: "2.5em", color: colors.left.dark }}
                    >
                      {formatConversionRate(t, segment1.cr)}
                    </div>
                    <span className="text-muted">
                      {numberFormatter.format(segment1.value)} /{" "}
                      {numberFormatter.format(
                        segment1.users || results.users.segment1
                      )}
                    </span>
                  </div>
                  <div className="col-md-6 order-3 order-md-2">
                    {segment2.buckets && segment2.buckets.length > 0 ? (
                      <PercentImprovementGraph
                        uid={m}
                        domain={[-1 * max, max]}
                        buckets={segment2.buckets}
                        ci={segment2.ci}
                        expected={segment2.expected}
                        inverse={getMetricById(m)?.inverse}
                        theme="neutral"
                      />
                    ) : (
                      <div className="alert alert-warning mt-3">
                        Not enough data
                      </div>
                    )}
                  </div>
                  <div className="col-6 col-md-3 order-2 order-md-3">
                    <div
                      className="pt-2 pt-md-5"
                      style={{ fontSize: "2.5em", color: colors.right.dark }}
                    >
                      {formatConversionRate(t, segment2.cr)}
                    </div>
                    <span className="text-muted">
                      {numberFormatter.format(segment2.value)} /{" "}
                      {numberFormatter.format(
                        segment2.users || results.users.segment2
                      )}
                    </span>
                  </div>
                </div>
                {segment2.buckets && segment2.buckets.length > 0 && (
                  <div className="row">
                    <div className="col">
                      {ciUpperDisplay} confident that the difference is between{" "}
                      <strong>{percentFormatter.format(segment2.ci[0])}</strong>{" "}
                      and{" "}
                      <strong>{percentFormatter.format(segment2.ci[1])}</strong>{" "}
                      with an average of{" "}
                      <strong>
                        {percentFormatter.format(segment2.expected)}
                      </strong>
                      .
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SegmentComparisonPage;
