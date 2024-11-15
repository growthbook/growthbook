import { useFormContext } from "react-hook-form";
import { hasFileConfig } from "@/services/env";
import { supportedCurrencies } from "@/services/settings";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

export default function MetricsSettings() {
  const form = useFormContext();
  const metricAnalysisDays = form.watch("metricAnalysisDays");
  const metricAnalysisDaysWarningMsg =
    metricAnalysisDays && metricAnalysisDays > 365
      ? "使用更多历史数据会减慢指标分析查询的速度"
      : "";
  const currencyOptions = Object.entries(
    supportedCurrencies
  ).map(([value, label]) => ({ value, label }));
  return (
    <div className="row">
      <div className="col-sm-3">
        <h4>指标设置</h4>
      </div>
      <div className="col-sm-9">
        <div className="form-inline">
          <Field
            label="在指标分析页面上使用的历史数据量"
            type="number"
            append="天"
            className="ml-2"
            containerClassName="mb-0"
            disabled={hasFileConfig()}
            {...form.register("metricAnalysisDays", {
              valueAsNumber: true,
            })}
          />
          {metricAnalysisDaysWarningMsg && (
            <small className="text-danger">
              {metricAnalysisDaysWarningMsg}
            </small>
          )}
        </div>

        {/* region 指标行为默认值 */}
        <>
          <h5 className="mt-4">指标行为默认值</h5>
          <p>
            这些是配置指标时将使用的预先配置的默认值。您始终可以根据每个指标的情况来更改这些值。
          </p>

          {/* region 最小样本量 */}
          <div>
            <div className="Minimum Sample Size">
              <Field
                label="最小样本量"
                type="number"
                min={0}
                className="ml-2"
                containerClassName="mt-2"
                disabled={hasFileConfig()}
                {...form.register("metricDefaults.minimumSampleSize", {
                  valueAsNumber: true,
                  min: 0,
                })}
              />
            </div>
            <p>
              <small className="text-muted mb-3">
                在显示结果之前，实验变体中所需的总计数。
              </small>
            </p>
          </div>
          {/* endregion 最小样本量 */}

          {/* region 最大百分比变化 */}
          <div>
            <div className="form-inline">
              <Field
                label="最大百分比变化"
                type="number"
                min={0}
                append="%"
                className="ml-2"
                containerClassName="mt-2"
                disabled={hasFileConfig()}
                {...form.register("metricDefaults.maxPercentageChange", {
                  valueAsNumber: true,
                  min: 0,
                })}
              />
            </div>
            <p>
              <small className="text-muted mb-3">
                如果一个实验使指标的变化超过此百分比，将被标记为可疑。
              </small>
            </p>
          </div>
          {/* endregion 最大百分比变化 */}

          {/* region 最小百分比变化 */}
          <div>
            <div className="表单内联">
              <Field
                label="最小百分比变化"
                type="number"
                min={0}
                append="%"
                className="ml-2"
                containerClassName="mt-2"
                disabled={hasFileConfig()}
                {...form.register("metricDefaults.minPercentageChange", {
                  valueAsNumber: true,
                  min: 0,
                })}
              />
            </div>
            <p>
              <small className="文本-灰色 mb-3">
                如果一个实验使指标的变化小于此百分比，将被视为平局。
              </small>
            </p>
          </div>
          {/* endregion 最小百分比变化 */}
        </>
        {/* endregion 指标行为默认值 */}
        <>
          <SelectField
            label="显示货币"
            value={form.watch("displayCurrency") || "USD"}
            options={currencyOptions}
            onChange={(v: string) => form.setValue("displayCurrency", v)}
            required
            placeholder="选择货币..."
            helpText="这应与存储在数据源中的内容匹配，并控制显示的货币符号。"
          />
        </>
      </div>
    </div>
  );
}