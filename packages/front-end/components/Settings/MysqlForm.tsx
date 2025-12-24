import { FC, ChangeEventHandler } from "react";
import { MysqlConnectionParams } from "shared/types/integrations/mysql";
import HostWarning from "./HostWarning";
import SSLConnectionFields from "./SSLConnectionFields";

const MysqlForm: FC<{
  params: Partial<MysqlConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <>
      <HostWarning
        host={params.host}
        setHost={(host) => {
          setParams({
            host,
          });
        }}
      />
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
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="password"
            required={!existing}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? "(Keep existing)" : ""}
          />
        </div>
        <SSLConnectionFields
          onParamChange={onParamChange}
          setSSL={(ssl) => setParams({ ssl })}
          value={{
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'boolean | undefined' is not assignable to ty... Remove this comment to see the full error message
            ssl: params.ssl,
            caCert: params.caCert,
            clientCert: params.clientCert,
            clientKey: params.clientKey,
          }}
        />
      </div>
    </>
  );
};

export default MysqlForm;
