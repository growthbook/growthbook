import { FC, ChangeEventHandler } from "react";
import { PrestoConnectionParams } from "back-end/types/integrations/presto";
import HostWarning from "./HostWarning";

const PrestoForm: FC<{
  params: Partial<PrestoConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  setParams: (params: { [key: string]: string }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>Engine</label>
        <select
          className="form-control"
          name="engine"
          required
          value={params.engine || ""}
          onChange={onParamChange}
        >
          <option value="presto">presto</option>
          <option value="trino">trino</option>
        </select>
      </div>
      <div className="col-md-12">
        <HostWarning
          host={params.host}
          setHost={(host) => {
            setParams({
              host,
            });
          }}
        />
      </div>
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
          value={params.port || 0}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Username</label>
        <input
          type="text"
          className="form-control"
          name="username"
          required
          value={params.username || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Password</label>
        <input
          type="text"
          className="form-control"
          name="password"
          value={params.password || ""}
          onChange={onParamChange}
          placeholder={existing ? "(Keep existing)" : ""}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Catalog</label>
        <input
          type="text"
          className="form-control"
          name="catalog"
          value={params.catalog || ""}
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
    </div>
  );
};

export default PrestoForm;
