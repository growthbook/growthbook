import { FC, ChangeEventHandler } from "react";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
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
            required
            value={params.database || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>用户</label>
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
          <label>密码</label>
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
        <div className="form-group col-md-12">
          <label>默认Schema</label>
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
