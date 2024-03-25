import Field from "@front-end/components/Forms/Field";
import MetricsSelector from "@front-end/components/Experiment/MetricsSelector";
import { ConnectSettingsForm } from "@front-end/pages/settings";

export default function NorthStarMetricSettings() {
  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <div className="my-3 bg-white p-3 border">
          <div className="row">
            <div className="col-sm-3">
              <h4>North Star Metrics</h4>
            </div>
            <div className="col-sm-9">
              <p>
                North stars are metrics your team is focused on improving. These
                metrics are shown on the home page with the experiments that
                have the metric as a goal.
              </p>
              <div className={"form-group"}>
                <div className="my-3">
                  <div className="form-group">
                    <label>Metric(s)</label>
                    <MetricsSelector
                      selected={watch("northStar.metricIds")}
                      onChange={(metricIds) =>
                        setValue("northStar.metricIds", metricIds)
                      }
                    />
                  </div>
                  <Field
                    label="Title"
                    value={watch("northStar.title")}
                    onChange={(e) => {
                      setValue("northStar.title", e.target.value);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConnectSettingsForm>
  );
}
