import { FC, ChangeEventHandler } from "react";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import Checkbox from "@/ui/Checkbox";
import { KEEP_EXISTING_PLACEHOLDER } from "@/components/Forms/secretInput";
import HostWarning from "./HostWarning";

const ClickHouseForm: FC<{
  params: Partial<ClickHouseConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
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
        <div className="form-group col-md-6">
          <label>Port</label>
          <input
            type="number"
            className="form-control"
            name="port"
            required
            value={params.port || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-6">
          <label>Database</label>
          <input
            type="text"
            className="form-control"
            name="database"
            value={params.database || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-6">
          <label>Username</label>
          <input
            type="text"
            className="form-control"
            name="username"
            value={params.username || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-6">
          <label>Password</label>
          <input
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="password"
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? KEEP_EXISTING_PLACEHOLDER : ""}
          />
        </div>
        <div className="form-group col-md-12">
          <label>Max Query Execution Time (seconds)</label>
          <input
            type="number"
            className="form-control"
            name="maxExecutionTime"
            value={params.maxExecutionTime}
            onChange={onParamChange}
            min={0}
            max={3600}
            placeholder={"Default: 1800"}
          />
        </div>
      </div>
      <Checkbox
        id="clickhouse-materialized-ctes"
        label="Use materialized CTEs (experimental)"
        value={params.useMaterializedCTEs === true}
        setValue={(value) => setParams({ useMaterializedCTEs: value })}
        description="Enable only if your ClickHouse deployment supports AS MATERIALIZED and has enable_materialized_cte enabled."
      />
    </>
  );
};

export default ClickHouseForm;
