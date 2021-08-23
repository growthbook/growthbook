import { FC, ChangeEventHandler } from "react";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { isCloud } from "../../services/env";

const PostgresForm: FC<{
  params: Partial<PostgresConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}> = ({ params, existing, onParamChange }) => {
  return (
    <>
      {isCloud() ? (
        <div className="row">
          <div className="col-auto">
            <div className="alert alert-info">
              Make sure to whitelist the IP Address <code>52.70.79.40</code> so
              Growth Book can reach your database.
            </div>
          </div>
        </div>
      ) : null}
      <div className="row">
        <div className="form-group col-md-12">
          <label>Host</label>
          <input
            type="text"
            className="form-control"
            name="host"
            required
            value={params.host || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
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
        <div className="form-group col-md-12">
          <label>Database</label>
          <input
            type="text"
            className="form-control"
            name="database"
            required
            value={params.database || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>User</label>
          <input
            type="text"
            className="form-control"
            name="user"
            required
            value={params.user || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>Password</label>
          <input
            type="password"
            className="form-control"
            name="password"
            required={!existing}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? "(Keep existing)" : ""}
          />
        </div>
        <div className="form-group col-md-12">
          <label>Require SSL</label>
          <select
            className="form-control"
            name="ssl"
            value={
              params.ssl === true || params.ssl === "true" ? "true" : "false"
            }
            onChange={onParamChange}
          >
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </div>
        <div className="form-group col-md-12">
          <label>Default Schema</label>
          <input
            type="text"
            className="form-control"
            name="defaultSchema"
            value={params.defaultSchema || ""}
            onChange={onParamChange}
            placeholder="(optional)"
          />
        </div>
      </div>
    </>
  );
};

export default PostgresForm;
