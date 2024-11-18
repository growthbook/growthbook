import { DataSourceSettings } from "back-end/types/datasource";
import { ChangeEventHandler } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";

export interface Props {
  settings: Partial<DataSourceSettings>;
  onSettingChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}

export default function SharedConnectionSettings({
  settings,
  onSettingChange,
}: Props) {
  return (
    <>
      <div className="row">
        <div className="col-md-12">
          <Field
            name="maxConcurrentQueries"
            type="number"
            label={
              <>
                最大并发查询数（可选）{" "}
                <Tooltip
                  body={
                    "当针对此数据源执行查询时，如果已经有这么多查询正在运行，那么新的连接将会等待现有连接完成。此限制并非精确的，" +
                    "例如，如果设置为 100，在许多查询是由单个实验更新发起的情况下，它仍可能允许略超过 100 个查询同时运行。"
                  }
                />
              </>
            }
            helpText="0 或空字段表示对查询数量没有限制"
            value={settings.maxConcurrentQueries || ""}
            onChange={onSettingChange}
            min={0}
          />
        </div>
      </div>
    </>
  );
}
