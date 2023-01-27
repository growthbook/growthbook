import { FC, ChangeEventHandler } from "react";
import { DatabricksConnectionParams } from "back-end/types/integrations/databricks";
import HostWarning from "./HostWarning";

const DatabricksForm: FC<{
  params: Partial<DatabricksConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <div className="row">
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
        <label>Server Hostname</label>
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
          value={params.port || 443}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>HTTP Path</label>
        <input
          type="text"
          className="form-control"
          name="path"
          required
          value={params.path || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Token</label>
        <input
          type="text"
          className="form-control"
          name="token"
          value={params.token || ""}
          onChange={onParamChange}
          placeholder={existing ? "(Keep existing)" : ""}
        />
      </div>
    </div>
  );
};

export default DatabricksForm;
