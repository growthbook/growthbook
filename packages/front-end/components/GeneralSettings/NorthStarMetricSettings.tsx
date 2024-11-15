import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { ConnectSettingsForm } from "@/pages/settings";

export default function NorthStarMetricSettings() {
  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <div className="my-3 bg-white p-3 border">
          <div className="row">
            <div className="col-sm-3">
              <h4>北极星指标</h4>
            </div>
            <div className="col-sm-9">
              <p>
                北极星指标是您的团队重点关注并致力于改进的指标。这些指标会和以该指标为目标的实验一起显示在主页上。
              </p>
              <div className="form-group">
                <div className="my-3">
                  <div className="form-group">
                    <label>指标(多个)</label>
                    <MetricsSelector
                      selected={watch("northStar.metricIds")}
                      onChange={(metricIds) => setValue("northStar.metricIds", metricIds)
                      }
                      includeFacts={true}
                      includeGroups={false}
                      excludeQuantiles={true}
                    />
                  </div>
                  <Field
                    label="标题"
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