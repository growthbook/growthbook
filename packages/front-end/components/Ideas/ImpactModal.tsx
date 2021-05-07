import Link from "next/link";
import { FC } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import { useMetrics } from "../../services/MetricsContext";
import { useSegments } from "../../services/SegmentsContext";
import { IdeaInterface } from "back-end/types/idea";
import { ImpactEstimateInterface } from "back-end/types/impact-estimate";
import Modal from "../Modal";

const ImpactModal: FC<{
  idea?: IdeaInterface;
  estimate?: ImpactEstimateInterface;
  close: () => void;
  mutate: () => void;
}> = ({ idea, estimate, close, mutate }) => {
  const { metrics, getMetricDatasource } = useMetrics();
  const { segments } = useSegments();

  const { apiCall } = useAuth();

  const [value, inputProps] = useForm({
    metric: estimate?.metric || metrics[0]?.id || "",
    segment: estimate?.segment || "",
    page: estimate?.regex || ".*",
    userAdjustment: idea.estimateParams?.userAdjustment || 100,
    numVariations: idea.estimateParams?.numVariations || 2,
    improvement: idea.estimateParams?.improvement || 10,
  });

  const possibleMetrics = metrics.filter(
    // TODO: support non-binomial and manual metrics
    (m) => m.type === "binomial" && m.datasource
  );

  const datasource = getMetricDatasource(value.metric);
  const possibleSegments = segments.filter((s) => s.datasource == datasource);

  return (
    <Modal
      header="Impact Score Paramters"
      open={true}
      submit={async () => {
        // Need an API call to get an updated estimate
        let est = estimate;
        if (
          !estimate ||
          estimate.regex !== value.page ||
          estimate.metric !== value.metric ||
          (estimate.segment || "") !== value.segment
        ) {
          const res = await apiCall<{ estimate: ImpactEstimateInterface }>(
            `/ideas/impact`,
            {
              method: "POST",
              body: JSON.stringify({
                metric: value.metric,
                regex: value.page,
                segment: value.segment || null,
              }),
            }
          );
          est = res.estimate;
        }

        if (!est) {
          throw new Error(
            "Failed to get user and page data from the data source"
          );
        }

        const cr = est.users ? est.value / est.users : 0;

        const trafficPerVariationPerDay =
          ((value.userAdjustment / 100) * est.users) / value.numVariations;

        const variance = cr * (1 - cr);

        const sampleSize =
          (15.3664 * variance) / Math.pow((value.improvement / 100) * cr, 2);

        const days = sampleSize / trafficPerVariationPerDay;
        const experimentLength = days < 7 ? 7 : days;

        const impact = (est.value / est.metricTotal) * (7 / experimentLength);

        const data: Partial<IdeaInterface> = {
          impactScore: Math.floor(impact * 100),
          experimentLength,
          estimateParams: {
            estimate: est.id,
            improvement: value.improvement,
            numVariations: value.numVariations,
            userAdjustment: value.userAdjustment,
          },
        };

        await apiCall(`/idea/${idea.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      }}
      cta="Save"
      close={close}
    >
      <div className="form-group">
        Primary Metric
        <select className="form-control" {...inputProps.metric}>
          {possibleMetrics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <small className="form-text text-muted">
          Only binomial metrics are supported at this time
        </small>
      </div>
      <div className="form-group">
        Effect Size
        <select className="form-control" {...inputProps.improvement}>
          <option value="1">Tiny (&lt;1%)</option>
          <option value="5">Small (5%)</option>
          <option value="10">Medium (10%)</option>
          <option value="20">Large (20%)</option>
          <option value="50">Huge (50%)</option>
        </select>
        <small className="form-text text-muted">
          How much do you think this will improve the metric?
        </small>
      </div>
      <div className="form-group">
        Number of Vaiations
        <input
          type="number"
          className="form-control"
          min="2"
          max="20"
          step="1"
          {...inputProps.numVariations}
        />
        <small className="form-text text-muted">Including the baseline</small>
      </div>
      <div className="form-group">
        Experiment URLs
        <input type="text" className="form-control" {...inputProps.page} />
        <small className="form-text text-muted">
          URLs where this experiment will run (regular expression)
        </small>
      </div>
      <div className="form-group">
        User Segment
        <select
          className="form-control"
          disabled={!possibleSegments?.length}
          {...inputProps.segment}
        >
          <option value="">Everyone</option>
          {possibleSegments &&
            possibleSegments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        {!possibleSegments?.length && (
          <small className="form-text text-muted">
            No segments defined for the selected metric&apos;s datasource.{" "}
            <Link href="/segments">
              <a>Add Segments</a>
            </Link>
            .
          </small>
        )}
      </div>
    </Modal>
  );
};

export default ImpactModal;
