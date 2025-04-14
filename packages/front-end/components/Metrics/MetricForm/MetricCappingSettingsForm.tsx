import { CappingType } from "back-end/types/fact-table";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Toggle from "@/components/Forms/Toggle";

export function MetricCappingSettingsForm({
  form,
  datasourceType,
  metricType,
}) {
  const cappingOptions = [
    {
      value: "",
      label: "否",
    },
    ...(metricType !== "ratio"
      ? [
        {
          value: "absolute",
          label: "绝对封顶",
        },
      ]
      : []),
    ...(datasourceType !== "mixpanel"
      ? [
        {
          value: "percentile",
          label: "百分位数封顶",
        },
      ]
      : []),
  ];
  return (
    <div className="form-group">
      <SelectField
        label="是否限制用户值？"
        value={form.watch("cappingSettings.type")}
        onChange={(v: CappingType) => {
          form.setValue("cappingSettings.type", v);
        }}
        sort={false}
        options={cappingOptions}
        helpText="封顶（缩尾处理）可以通过限制聚合的用户值来减少方差。"
      />
      <div
        style={{
          display: form.watch("cappingSettings.type") ? "block" : "none",
        }}
        className="appbox p-3 bg-light"
      >
        {form.watch("cappingSettings.type") ? (
          <>
            <Field
              label="限制值"
              type="number"
              step="any"
              min="0"
              max={
                form.watch("cappingSettings.type") === "percentile" ? "1" : ""
              }
              {...form.register("cappingSettings.value", {
                valueAsNumber: true,
              })}
              helpText={
                form.watch("cappingSettings.type") === "absolute"
                  ? `
              绝对封顶：如果大于零，聚合的用户值将被限制在这个值。`
                  : `百分位数封顶：如果大于零，我们将使用实验中的所有指标数据来计算用户聚合值的百分位数。然后，我们获取所提供百分位数处的值，并将所有用户的值限制在这个值。输入一个介于 0 和 0.99999 之间的数字`
              }
            />
            {form.watch("cappingSettings.type") === "percentile" ? (
              <div className="mt-3">
                <label className="mr-1" htmlFor="toggle-ignoreZeros">
                  在计算百分位数时是否忽略零值？
                </label>
                <Toggle
                  value={form.watch("cappingSettings.ignoreZeros")}
                  setValue={(ignoreZeros) => {
                    form.setValue("cappingSettings.ignoreZeros", ignoreZeros);
                  }}
                  id={"ignoreZeros"}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
