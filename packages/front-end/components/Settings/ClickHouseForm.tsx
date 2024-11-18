import { FC, ChangeEventHandler } from "react";
import { ClickHouseConnectionParams } from "back-end/types/integrations/clickhouse";
import HostWarning from "./HostWarning";

const ClickHouseForm: FC<{
  params: Partial<ClickHouseConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <>
      <HostWarning
        host={params.url}
        setHost={(url) => {
          setParams({
            url,
          });
        }}
      />
      <div className="row">
        <div className="form-group col-md-12">
          <label>URL</label>
          <input
            type="text"
            className="form-control"
            name="url"
            required
            value={params.url || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>端口（Port）</label>
          <input
            type="number"
            className="form-control"
            name="port"
            required
            value={params.port || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>数据库</label>
          <input
            type="text"
            className="form-control"
            name="database"
            value={params.database || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>用户名</label>
          <input
            type="text"
            className="form-control"
            name="username"
            value={params.username || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>密码</label>
          <input
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="password"
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? "(Keep existing)" : ""}
          />
        </div>
        <div className="form-group col-md-12">
          <label>最大查询执行时间（秒）</label>
          <input
            type="number"
            className="form-control"
            name="maxExecutionTime"
            value={params.maxExecutionTime}
            onChange={onParamChange}
            min={0}
            max={3600}
            placeholder={"默认值：1800"}
          />
        </div>
      </div>
    </>
  );
};

export default ClickHouseForm;
