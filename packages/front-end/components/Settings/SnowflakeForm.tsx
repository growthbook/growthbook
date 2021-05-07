import { FC, ChangeEventHandler } from "react";
import { SnowflakeConnectionParams } from "back-end/types/integrations/snowflake";

const SnowflakeForm: FC<{
  params: Partial<SnowflakeConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
}> = ({ params, existing, onParamChange }) => {
  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>Account</label>
        <input
          type="text"
          className="form-control"
          name="account"
          placeholder="xy12345.us-east-2.aws"
          value={params.account || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Username</label>
        <input
          type="text"
          className="form-control"
          name="username"
          value={params.username || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Password</label>
        <input
          type="password"
          className="form-control"
          name="password"
          value={params.password || ""}
          onChange={onParamChange}
          placeholder={existing ? "(Keep existing)" : ""}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Database</label>
        <input
          type="text"
          className="form-control"
          name="database"
          value={params.database || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Schema</label>
        <input
          type="text"
          className="form-control"
          name="schema"
          value={params.schema || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Warehouse</label>
        <input
          type="text"
          className="form-control"
          name="warehouse"
          value={params.warehouse || ""}
          onChange={onParamChange}
        />
      </div>
    </div>
  );
};

export default SnowflakeForm;
