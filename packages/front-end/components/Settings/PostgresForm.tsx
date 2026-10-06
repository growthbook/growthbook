import { FC, ChangeEventHandler } from "react";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { KEEP_EXISTING_PLACEHOLDER } from "@/components/Forms/secretInput";
import HostWarning from "./HostWarning";
import SSLConnectionFields from "./SSLConnectionFields";

const PostgresForm: FC<{
  params: Partial<PostgresConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  setParams: (params: { [key: string]: string }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <>
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
            required
            value={params.database || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-6">
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
        <div className="form-group col-md-6">
          <label>Password</label>
          <input
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="password"
            required={!existing}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? KEEP_EXISTING_PLACEHOLDER : ""}
          />
        </div>
        <div className="form-group col-md-6">
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
        <SSLConnectionFields
          existing={existing}
          onParamChange={onParamChange}
          setSSL={(ssl) => setParams({ ssl: ssl ? "true" : "" })}
          value={{
            ssl: params.ssl === true || params.ssl === "true",
            caCert: params.caCert,
            clientCert: params.clientCert,
            clientKey: params.clientKey,
          }}
        />
      </div>
    </>
  );
};

export default PostgresForm;
