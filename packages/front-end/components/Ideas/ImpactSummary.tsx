import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import { ImpactEstimateInterface } from "back-end/types/impact-estimate";
import Button from "../Button";
import Modal from "../Modal";
import useForm from "../../hooks/useForm";
import ViewQueryButton from "../Metrics/ViewQueryButton";
import { MetricInterface } from "back-end/types/metric";

export type SaveImpactFunction = (data: {
  estimate: ImpactEstimateInterface;
  userAdjustment: number;
  numVariations: number;
  improvement: number;
  impactScore: number;
  experimentLength: number;
}) => Promise<void>;

function formatNumber(num: number): string {
  if (num > 1000000) {
    return Math.floor(num / 1000000) + "m";
  } else if (num > 1000) {
    return Math.floor(num / 1000) + "k";
  } else if (num > 10) {
    return num.toFixed(0);
  }
  return num.toFixed(2);
}

function formatDays(num: number): string {
  if (num > 365) {
    return Math.floor(num / 365) + "+ years";
  } else if (num > 21) {
    return Math.floor(num / 7) + "+ weeks";
  }
  return Math.ceil(num) + " days";
}

const ImpactSummary: FC<{
  initialEstimate?: ImpactEstimateInterface;
  initialImpactScore: number;
  metric: Partial<MetricInterface>;
  regex: string;
  userTargeting: number;
  variations: number;
  mde: number;
  onSave: SaveImpactFunction;
  isStale: boolean;
}> = ({
  initialEstimate,
  initialImpactScore,
  regex,
  metric,
  userTargeting,
  variations,
  mde,
  onSave,
  isStale,
}) => {
  const { apiCall } = useAuth();
  const [estimate, setEstimate] = useState<ImpactEstimateInterface | null>(
    initialEstimate || null
  );
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [values, inputProps] = useForm(
    {
      value: 0,
      metricTotal: 0,
      users: 0,
    },
    metric + regex
  );

  if (!metric) {
    return null;
  }

  // Need more info for a manual metric
  if (manualModalOpen) {
    return (
      <Modal
        header="Estimated Impact: More Info Needed"
        open={true}
        close={() => setManualModalOpen(false)}
        submit={async () => {
          const res = await apiCall<{ estimate: ImpactEstimateInterface }>(
            `/ideas/estimate/manual`,
            {
              method: "POST",
              body: JSON.stringify({
                ...values,
                metric: metric.id,
                regex,
              }),
            }
          );
          setEstimate(res.estimate);
        }}
      >
        <p>
          <strong>Metric:</strong> {metric.name}
        </p>
        <h4>Entire Site</h4>
        <div className="form-group">
          Completed Metric
          <div className="input-group">
            <input
              type="number"
              className="form-control"
              min="1"
              required
              {...inputProps.metricTotal}
            />
            <div className="input-group-append">
              <div className="input-group-text">users per day</div>
            </div>
          </div>
        </div>
        <hr />
        <h4>Selected URLs Only</h4>
        <div className="bg-white border p-2 my-3">
          <strong>
            <code>{regex}</code>
          </strong>
        </div>
        <div className="form-group">
          Viewed Experiment URLs
          <div className="input-group">
            <input
              type="number"
              className="form-control"
              min="1"
              required
              {...inputProps.users}
            />
            <div className="input-group-append">
              <div className="input-group-text">users per day</div>
            </div>
          </div>
        </div>
        <div className="form-group">
          Completed Metric
          <div className="input-group">
            <input
              type="number"
              className="form-control"
              min="1"
              required
              {...inputProps.value}
            />
            <div className="input-group-append">
              <div className="input-group-text">users per day</div>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  // Need an API call to get an updated estimate
  if (!estimate || estimate.regex !== regex || estimate.metric !== metric.id) {
    return (
      <div>
        <Button
          onClick={async () => {
            const res = await apiCall<{ estimate: ImpactEstimateInterface }>(
              `/ideas/impact`,
              {
                method: "POST",
                body: JSON.stringify({
                  metric: metric.id,
                  regex,
                }),
              }
            );

            if (res.estimate) {
              setEstimate(res.estimate);
            } else if (!metric.datasource) {
              setManualModalOpen(true);
            }
          }}
          color="primary"
        >
          {estimate ? "Re-calculate Estimate" : "Estimate Impact"}
        </Button>
      </div>
    );
  }

  const cr = estimate.users ? estimate.value / estimate.users : 0;

  const trafficPerVariationPerDay =
    (userTargeting * estimate.users) / variations;

  const conversionsPerVariationPerDay = trafficPerVariationPerDay * cr;

  const variance = cr * (1 - cr);

  const sampleSize = (15.3664 * variance) / Math.pow(mde * cr, 2);

  const days = sampleSize / trafficPerVariationPerDay;
  const length = days < 7 ? 7 : days;

  const impact = (estimate.value / estimate.metricTotal) * (7 / length);

  return (
    <div className="row text-center">
      <div className="col-auto mb-3">
        <div className="p-2 border h-100 bg-impact text-light">
          <div className="d-flex h-100 flex-column">
            <h5>Impact Score</h5>
            <div style={{ flex: 1 }}></div>
            <div style={{ fontSize: "3.6em" }}>{Math.floor(impact * 100)}</div>
            <div style={{ flex: 1 }}></div>
            <div>/ 100</div>
          </div>
        </div>
      </div>
      <div className="col-auto mb-3">
        <div className="p-2 border h-100">
          <div className="d-flex h-100 flex-column">
            <h5>Users</h5>
            <div style={{ flex: 1 }}></div>
            <div style={{ fontSize: "3.6em" }}>
              {formatNumber(trafficPerVariationPerDay)}
            </div>
            <div style={{ flex: 1 }}></div>
            <div>/ variation / day</div>
          </div>
        </div>
      </div>
      <div className="col-auto mb-3">
        <div className="p-2 border h-100">
          <div className="d-flex h-100 flex-column">
            <h5>Conversion Rate</h5>
            <div style={{ flex: 1 }}></div>
            <div style={{ fontSize: "3.6em" }}>
              {parseFloat((cr * 100).toFixed(1))}%
            </div>
            <div style={{ flex: 1 }}></div>
            <div>/ variation / day</div>
          </div>
        </div>
      </div>
      <div className="col-auto mb-3">
        <div className="p-2 border h-100">
          <div className="d-flex h-100 flex-column">
            <h5>Conversions</h5>
            <div style={{ flex: 1 }}></div>
            <div style={{ fontSize: "3.6em" }}>
              {formatNumber(conversionsPerVariationPerDay)}
            </div>
            <div style={{ flex: 1 }}></div>
            <div>/ variation / day</div>
          </div>
        </div>
      </div>
      <div className="col-auto mb-3">
        <div className="p-2 border h-100">
          <div className="d-flex h-100 flex-column">
            <h5>Experiment Length</h5>
            <div style={{ flex: 1 }}></div>
            <div style={{ fontSize: "3.6em" }}>{formatDays(length)}</div>
            <div style={{ flex: 1 }}></div>
            <div>minimum</div>
          </div>
        </div>
      </div>
      <div className="col-12 text-left">
        {(isStale || Math.floor(impact * 100) !== initialImpactScore) && (
          <Button
            color="primary"
            className="mr-2"
            onClick={async () => {
              await onSave({
                estimate,
                userAdjustment: userTargeting * 100,
                numVariations: variations,
                improvement: mde * 100,
                impactScore: Math.floor(impact * 100),
                experimentLength: Math.round(length),
              });
            }}
          >
            Save Estimated Impact
          </Button>
        )}
        {estimate.query?.length > 0 && (
          <ViewQueryButton
            queries={[estimate.query]}
            language={estimate.queryLanguage}
          />
        )}
      </div>
    </div>
  );
};

export default ImpactSummary;
