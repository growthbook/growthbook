import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

// TODO form type
export function MetricWindowSettingsForm({ form }) {
  const windowSettingsFields = (
    <>
      <div className="col-auto">
        <Field
          {...form.register("windowSettings.windowValue", {
            valueAsNumber: true,
          })}
          type="number"
          min={1}
          max={999}
          step={1}
          style={{ width: 70 }}
          required
          autoFocus
        />
      </div>
      <div className="col-auto">
        <SelectField
          value={form.watch("windowSettings.windowUnit")}
          onChange={(value) => {
            form.setValue(
              "windowSettings.windowUnit",
              value as "days" | "hours" | "weeks"
            );
          }}
          sort={false}
          options={[
            {
              label: "小时",
              value: "hours",
            },
            {
              label: "天",
              value: "days",
            },
            {
              label: "周",
              value: "weeks",
            },
          ]}
        />
      </div>
    </>
  );
  return (
    <div className="mb-3 mt-4">
      <div className="form-group mb-1">
        <SelectField
          label={"指标窗口"}
          value={form.watch("windowSettings.type")}
          onChange={(value) => {
            form.setValue(
              "windowSettings.type",
              value as "conversion" | "lookback" | ""
            );
          }}
          sort={false}
          options={[
            {
              label: "无",
              value: "",
            },
            {
              label: "转化窗口",
              value: "conversion",
            },
            {
              label: "回溯窗口",
              value: "lookback",
            },
          ]}
        />
      </div>

      {form.watch("windowSettings.type") && (
        <div className="appbox p-3 bg-light">
          <div className="row align-items-center">
            {form.watch("windowSettings.type") === "conversion" && (
              <>
                <div className="col-auto">仅使用以下时间范围内的数据</div>
                {windowSettingsFields}
                <div className="col-auto">
                  自首次实验曝光起{" "}
                  <Tooltip
                    body={
                      "如果您指定了转化延迟，那么转化窗口将是从首次实验曝光加上转化延迟开始的一段时间长度。"
                    }
                  />
                </div>
              </>
            )}
            {form.watch("windowSettings.type") === "lookback" && (
              <>
                <div className="col-auto">仅使用实验中最新的</div>
                {windowSettingsFields}
                <div className="col-auto">指标数据</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
