import { useFormContext } from "react-hook-form";
import { DEFAULT_TEST_QUERY_DAYS } from "shared/constants";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";

export default function DatasourceSettings() {
  const form = useFormContext();
  const { datasources } = useDefinitions();

  return (
    <div className="row">
      <div className="col-sm-3">
        <h4>数据源设置</h4>
      </div>
      <div className="col-sm-9">
        <SelectField
          label="默认数据源（可选）"
          value={form.watch("defaultDataSource") || ""}
          options={datasources.map((d) => ({
            label: d.name,
            value: d.id,
          }))}
          onChange={(v: string) => form.setValue("defaultDataSource", v)}
          isClearable={true}
          placeholder="选择一个数据源..."
          helpText="默认数据源是在创建指标和实验时所选的默认数据源。"
        />
        <div>
          <div className="form-inline">
            <Field
              label="测试查询回溯时长"
              type="number"
              min="1"
              append="天"
              className="ml-2"
              containerClassName="mt-2"
              {...form.register("testQueryDays", {
                valueAsNumber: true,
              })}
            />
          </div>
          <small className="form-text text-muted">
            {`在运行带有日期过滤器的测试查询时要回溯的天数。在验证事实表SQL时也会用到。如果为空，则使用默认的${DEFAULT_TEST_QUERY_DAYS}天。`}
          </small>
        </div>
      </div>
    </div>
  );
}