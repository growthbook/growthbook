import { FC, ChangeEventHandler } from "react";
import { PrestoConnectionParams } from "back-end/types/integrations/presto";
import SelectField from "../Forms/SelectField";
import HostWarning from "./HostWarning";
import SSLConnectionFields from "./SSLConnectionFields";

const PrestoForm: FC<{
  params: Partial<PrestoConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  onManualParamChange: (name: string, value: string) => void;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, onManualParamChange, setParams }) => {
  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>Engine</label>
        <SelectField
          name="engine"
          required
          value={params.engine || ""}
          onChange={(v) => {
            onManualParamChange("engine", v);
          }}
          options={[
            { value: "presto", label: "presto" },
            { value: "trino", label: "trino" },
          ]}
        />
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
        <label>Default Catalog</label>
        <input
          type="text"
          className="form-control"
          name="catalog"
          value={params.catalog || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Default Schema</label>
        <input
          type="text"
          className="form-control"
          name="schema"
          value={params.schema || ""}
          onChange={onParamChange}
        />
      </div>
      <SSLConnectionFields
        onParamChange={onParamChange}
        setSSL={(ssl) => setParams({ ssl })}
        value={{
          ssl: params.ssl,
          caCert: params.caCert,
          clientCert: params.clientCert,
          clientKey: params.clientKey,
        }}
      />
    </div>
  );
};

export default PrestoForm;
