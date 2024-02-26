import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";

export default function NorthStarMetricSettings({
  metricIds = [],
  onChangeMetricIds,
  title = "",
  onChangeTitle,
}: {
  metricIds: string[];
  onChangeMetricIds: (metricIds: string[]) => void;
  title: string;
  onChangeTitle: (title: string) => void;
}) {
  return (
    <div className="my-3 bg-white p-3 border">
      <div className="row">
        <div className="col-sm-3">
          <h4>North Star Metrics</h4>
        </div>
        <div className="col-sm-9">
          <p>
            North stars are metrics your team is focused on improving. These
            metrics are shown on the home page with the experiments that have
            the metric as a goal.
          </p>
          <div className={"form-group"}>
            <div className="my-3">
              <div className="form-group">
                <label>Metric(s)</label>
                <MetricsSelector
                  selected={metricIds}
                  onChange={onChangeMetricIds}
                />
              </div>
              <Field
                label="Title"
                value={title}
                onChange={(e) => {
                  onChangeTitle(e.target.value);
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
